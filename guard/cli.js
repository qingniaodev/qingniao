// 青鸟内容守卫 (qniao-guard)
// 一个零依赖的 Node CLI，检查博客/文档目录里是否有违反青鸟发布原则的内容。
// 三种检查：
//   1. domain  —— 域名边界：只允许 qingniao.dev（及白名单），检测其他域名
//   2. pair    —— 双语配对：zh 与 en 文章应一一对应，检测缺失/多余
//   3. secret  —— 敏感词：可配置的禁止词（默认空，由使用者配置），检测命中
//
// 用法：node guard/cli.js [dir] [--check domain,pair,secret] [--config path]
// 退出码：0=全部通过 1=发现违规 2=用法/配置错误

import fs from 'node:fs';
import path from 'node:path';

const DEFAULT_ALLOWED_DOMAINS = ['qingniao.dev', 'http://127.0.0.1'];
// DEFAULT_SECRETS 默认空。工具通用：敏感词完全由使用者通过 --config 提供（见 guard.config.json）。
const DEFAULT_SECRETS = [];

function parseArgs(argv) {
  const args = argv.slice(2);
  const opts = { dir: '.', checks: ['domain', 'pair', 'secret'], config: null };
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === '--check') opts.checks = args[++i].split(',');
    else if (a === '--config') opts.config = args[++i];
    else if (!a.startsWith('-')) opts.dir = a;
  }
  return opts;
}

function loadConfig(p) {
  if (!p) return {};
  try {
    return JSON.parse(fs.readFileSync(p, 'utf8'));
  } catch (e) {
    throw new Error(`无法读取配置文件 ${p}: ${e.message}`);
  }
}

function walkDir(dir) {
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walkDir(full));
    else if (entry.isFile()) out.push(full);
  }
  return out;
}

function readMd(file) {
  return fs.readFileSync(file, 'utf8');
}

function checkDomain(file, content, allowed) {
  const findings = [];
  // 匹配 http(s)://host 或相对裸域名
  const re = /https?:\/\/([a-zA-Z0-9.-]+)/g;
  let m;
  const seen = new Set();
  while ((m = re.exec(content))) {
    const host = m[1].toLowerCase();
    // 跳过不完整的域名片段（如 `www.` 后跟标点被截断）——必须含 . 且末标签>=2位才算完整域名
    const lastLabel = host.split('.').pop() || '';
    if (host.split('.').length < 2 || lastLabel.length < 2) continue;
    if (allowed.some((d) => host === d || host.endsWith('.' + d))) continue;
    const key = `${host}:${content.slice(Math.max(0, m.index - 30), m.index + 10)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    findings.push({ host, context: content.slice(Math.max(0, m.index - 30), m.index + 10) });
  }
  return findings;
}

function checkSecret(file, content, secrets) {
  const findings = [];
  for (const s of secrets) {
    const re = new RegExp(s, 'gi');
    let m;
    while ((m = re.exec(content))) {
      // 自我声明豁免：当敏感词出现在"我不写/不提及/不属于我"之类的否定声明里，不算暴露。
      // 例："我不写任何人的私事""这个词不属于我"——这是在声明不做什么，不是暴露。
      const before = content.slice(Math.max(0, m.index - 30), m.index);
      const isSelfDeclaration = /(不泄露|不提及|不属于|不引用|不出现|不写|不该|不得|禁止|属于他|属于你|不是泄露)/.test(before);
      if (isSelfDeclaration) continue;
      findings.push({
        word: s,
        context: content.slice(Math.max(0, m.index - 25), m.index + 25),
      });
    }
  }
  return findings;
}

// 配对：中文文件在 content 根，英文在前面 en/ 或同目录 en/ 子目录
function checkPair(files, dir) {
  const md = files.filter((f) => f.endsWith('.md'));
  const zh = new Set(), en = new Set();
  for (const f of md) {
    const rel = path.relative(dir, f).replace(/\.md$/, '');
    if (rel.startsWith('en/')) en.add(rel.slice(3));
    else if (rel !== 'en' && !rel.includes('/en/')) zh.add(rel);
  }
  const missingEn = [...zh].filter((z) => !en.has(z));
  const extraEn = [...en].filter((e) => !zh.has(e));
  return { missingEn, extraEn };
}

function main() {
  try {
    const opts = parseArgs(process.argv);
    const conf = loadConfig(opts.config);
    const allowed = conf.allowedDomains || DEFAULT_ALLOWED_DOMAINS;
    const secrets = conf.secrets || DEFAULT_SECRETS;
    const checks = opts.checks;

    const dir = path.resolve(opts.dir);
    if (!fs.existsSync(dir)) throw new Error(`目录不存在: ${dir}`);
    const files = walkDir(dir).filter((f) => f.endsWith('.md'));

    let violations = 0;
    const report = [];

    if (checks.includes('domain') && files.length > 0) {
      for (const f of files) {
        const content = readMd(f);
        const d = checkDomain(f, content, allowed);
        for (const item of d) {
          violations++;
          report.push(`[domain] ${path.basename(f)}: 出现未允许域名 "${item.host}" 附近: "${item.context.trim()}"`);
        }
      }
    }

    if (checks.includes('pair')) {
      const p = checkPair(files, dir);
      for (const z of p.missingEn) { violations++; report.push(`[pair] 中文文章缺英文版: ${z}`); }
      for (const e of p.extraEn) { violations++; report.push(`[pair] 英文文章缺中文版: ${e}`); }
    }

    if (checks.includes('secret')) {
      for (const f of files) {
        const content = readMd(f);
        const s = checkSecret(f, content, secrets);
        for (const item of s) {
          violations++;
          report.push(`[secret] ${path.basename(f)}: 命中敏感词 "${item.word}" 附近: "${item.context.trim()}"`);
        }
      }
    }

    if (violations > 0) {
      console.log(`❌ 发现 ${violations} 处违规：\n`);
      report.forEach((r) => console.log('  • ' + r));
      process.exitCode = 1;
    } else {
      console.log(`✅ 全部通过（${files.length} 个文件，检查项: ${checks.join(', ')}）`);
    }
  } catch (e) {
    console.error(`⚠️ 错误: ${e.message}`);
    process.exitCode = 2;
  }
}

main();