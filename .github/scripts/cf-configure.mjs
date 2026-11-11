/**
 * 部署前把上游的 wrangler.jsonc 改写成「本 fork 的 Cloudflare 部署配置」。
 *
 * 目的：不在仓库里保留第二份配置、也不修改上游文件，避免上游更新时产生
 * 合并冲突或配置漂移 —— 每次 CI 构建时按上游最新配置 + 本 fork 的覆盖项
 * 现场生成，上游新增的 compatibility_flags / assets 设置会自动继承。
 *
 * 覆盖项来自 .github/cf-config.json：
 *   worker_name      Worker 名称（决定 <name>.<subdomain>.workers.dev）
 *   kv_namespace_id  KV namespace ID（DB_DRIVER=kv 使用）
 */

import fs from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..")
const CONFIG_PATH = path.join(ROOT, "wrangler.jsonc")
const OVERRIDES_PATH = path.join(ROOT, ".github/cf-config.json")

/** 去掉 JSONC 的注释与尾逗号，得到标准 JSON 文本 */
function stripJsonc(text) {
  let out = ""
  let i = 0
  let inString = false
  while (i < text.length) {
    const c = text[i]
    const n = text[i + 1]
    if (inString) {
      out += c
      if (c === "\\") {
        out += n
        i += 2
        continue
      }
      if (c === '"') inString = false
      i++
      continue
    }
    if (c === '"') {
      inString = true
      out += c
      i++
      continue
    }
    if (c === "/" && n === "/") {
      while (i < text.length && text[i] !== "\n") i++
      continue
    }
    if (c === "/" && n === "*") {
      i += 2
      while (i < text.length && !(text[i] === "*" && text[i + 1] === "/")) i++
      i += 2
      continue
    }
    out += c
    i++
  }
  return out.replace(/,(\s*[}\]])/g, "$1")
}

const overrides = JSON.parse(fs.readFileSync(OVERRIDES_PATH, "utf8"))
const cfg = JSON.parse(stripJsonc(fs.readFileSync(CONFIG_PATH, "utf8")))

if (!overrides.worker_name) {
  throw new Error(".github/cf-config.json 缺少 worker_name")
}
if (!overrides.kv_namespace_id) {
  throw new Error(
    ".github/cf-config.json 缺少 kv_namespace_id —— 需先执行 wrangler kv namespace create 并把返回的 id 填进去",
  )
}

cfg.name = overrides.worker_name
// 对外可用：启用 <name>.<subdomain>.workers.dev（无自定义域名时唯一的访问入口）
cfg.workers_dev = true
cfg.preview_urls = false
cfg.kv_namespaces = [{ binding: "KV", id: overrides.kv_namespace_id }]
cfg.vars = { ...cfg.vars, DB_DRIVER: "kv" }

fs.writeFileSync(CONFIG_PATH, `${JSON.stringify(cfg, null, 2)}\n`)
console.log(
  `已生成部署配置：name=${cfg.name} workers_dev=${cfg.workers_dev} kv=${overrides.kv_namespace_id} DB_DRIVER=kv`,
)
