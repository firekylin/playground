import { parseBlueprint } from './blueprint.mjs';

export function decodeConfiguration(text) {
  const value = JSON.parse(text);
  if (value.format === 'firekylin-playground') {
    if (value.version !== 1) throw new Error('不支持此配置文件版本');
    return {
      name: String(value.name || value.configuration?.title || '导入的站点').slice(0, 100),
      configuration: parseBlueprint(JSON.stringify(value.configuration))
    };
  }
  const configuration = parseBlueprint(text);
  return { name: configuration.title, configuration };
}
