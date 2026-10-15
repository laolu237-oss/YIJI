import { applyImportedConfig, apiSettings } from '@/api/settings';
import { applySettingsUiToUi } from '@/state/ui';

/**
 * 配置导入导出(柏宝书)。
 *
 * 导出 = 当前全部设置的 JSON 快照,**不含副 API**(摘要/总结渠道列表 + 两类任务指派):
 * 渠道由酒馆扩展设置跨设备同步、且与柏宝绘共用同一份(共享存储),
 * 不随配置文件走——免得把一台机器的渠道列表(含密钥)倒灌进共享列表。
 *
 * 导入 = 读回快照并合并进当前设置:文件中出现的设置项才覆盖,缺少的项保持当前值;
 * 副 API 渠道与指派同样不导入(api/settings.ts 的 applyImportedConfig 双保险剔除)。
 */

/** 应用标识:导入时校验,防止把别家的配置倒进来。 */
const APP_ID = 'baibai-book';
/** 文件类型标识(与公共接口文档等其它导出文件区分)。 */
const TRANSFER_KIND = 'config-transfer';
/** 配置结构版本。字段有重大增减时 +1;旧版文件仍可按「缺字段保持当前值」兼容读取。 */
const SCHEMA_VERSION = 1;

export interface ConfigTransferFile {
  app: string;
  kind: string;
  schema: number;
  /** 导出时的插件版本(仅作展示/排查用,不参与导入校验) */
  pluginVersion: string;
  /** 导出时间(ISO 8601) */
  exportedAt: string;
  settings: Record<string, unknown>;
}

/** 当前设置的导出快照(深拷贝,剔除副 API 两个键)。 */
export function buildTransferSettings(): Record<string, unknown> {
  const snapshot = JSON.parse(JSON.stringify(apiSettings)) as Record<string, unknown>;
  // 副 API 不进配置文件:渠道(与柏宝绘共享)+ 摘要/总结指派
  delete snapshot.channels;
  delete snapshot.assignments;
  return snapshot;
}

/** 文件名时间戳:20261015_080000。 */
function fileStamp(d = new Date()): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}_${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
}

/** 组装导出文件对象。 */
export function buildTransferFile(version = ''): ConfigTransferFile {
  return {
    app: APP_ID,
    kind: TRANSFER_KIND,
    schema: SCHEMA_VERSION,
    pluginVersion: version,
    exportedAt: new Date().toISOString(),
    settings: buildTransferSettings(),
  };
}

/** 组装文件并触发浏览器下载。 */
export function downloadTransferFile(version = ''): void {
  const file = buildTransferFile(version);
  const blob = new Blob([JSON.stringify(file, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `柏宝书配置_${fileStamp()}.json`;
  a.click();
  URL.revokeObjectURL(url);
}

export type ParseResult =
  | { ok: true; settings: Record<string, unknown>; schema: number }
  | { ok: false; error: string };

/** 解析并校验导入文件文本;通过则返回其中的 settings 段。 */
export function parseTransferFile(text: string): ParseResult {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return { ok: false, error: '文件不是有效的 JSON,请选择本插件导出的配置文件。' };
  }
  if (!raw || typeof raw !== 'object') {
    return { ok: false, error: '配置文件内容为空或格式不正确。' };
  }
  const obj = raw as Partial<ConfigTransferFile>;
  if (obj.app !== APP_ID) {
    return {
      ok: false,
      error:
        obj.app === 'baibai-image'
          ? '这是柏宝绘的配置文件,请到柏宝绘设置里导入。'
          : '这不是柏宝书的配置文件。',
    };
  }
  if (obj.kind !== TRANSFER_KIND) {
    return { ok: false, error: '文件类型不是配置备份(kind 不匹配)。' };
  }
  if (!obj.settings || typeof obj.settings !== 'object' || Array.isArray(obj.settings)) {
    return { ok: false, error: '配置文件里没有有效的 settings 段。' };
  }
  return {
    ok: true,
    settings: obj.settings as Record<string, unknown>,
    schema: typeof obj.schema === 'number' ? obj.schema : 0,
  };
}

export type ImportResult = { ok: true; message: string } | { ok: false; error: string };

/** 读文件 → 校验 → 应用。返回导入结果摘要或错误信息。 */
export async function importTransferFile(file: File): Promise<ImportResult> {
  let text: string;
  try {
    text = await file.text();
  } catch {
    return { ok: false, error: '文件读取失败,请重试。' };
  }
  const parsed = parseTransferFile(text);
  if (!parsed.ok) return parsed;
  applyImportedConfig(parsed.settings);
  // 主题/导航位置/悬浮球等界面项是从 settings.ui 回灌进运行态的,导入后立即同步,
  // 免得用户看到「设置已导入但界面没变」、以为导入失败。
  applySettingsUiToUi();
  const count = Object.keys(parsed.settings).length;
  return {
    ok: true,
    message: `已导入配置(${count} 个设置项)。副 API 渠道与指派未受影响。`,
  };
}
