const ERROR_MAP: Record<string, { zh: string; en: string }> = {
  'LLM HTTP 401': { zh: 'API Key 无效，请检查配置', en: 'Invalid API key, please check settings' },
  'LLM HTTP 429': { zh: '请求频率超限，请稍后重试', en: 'Rate limited, please try again later' },
  'LLM HTTP 500': { zh: '模型服务暂时不可用', en: 'Model service temporarily unavailable' },
  'net::ERR': { zh: '网络连接失败，请检查网络', en: 'Network error, check connection' },
  'timeout': { zh: '请求超时，请稍后重试', en: 'Request timed out' },
  'AbortError': { zh: '请求已取消', en: 'Request cancelled' },
  'not configured': { zh: '请先配置大模型', en: 'Please configure LLM first' },
  'API key': { zh: 'API Key 未设置', en: 'API key not set' },
};

export function humanizeError(error: string, lang: string = 'zh'): string {
  for (const [pattern, msg] of Object.entries(ERROR_MAP)) {
    if (error.includes(pattern)) return lang === 'zh' ? msg.zh : msg.en;
  }
  return error.length > 100 ? error.slice(0, 100) + '...' : error;
}
