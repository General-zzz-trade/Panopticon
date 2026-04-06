import { useState, useEffect } from 'react';
import { Modal } from './Modal';

// ── Provider configs ────────────────────────────────────────────

const API_PROVIDERS = [
  // ── 本地模型 ──
  { id: 'ollama', name: 'Ollama（本地模型）', baseUrl: 'http://localhost:11434/v1', models: ['llama3.2', 'llama3.1', 'qwen2.5', 'deepseek-r1', 'gemma2', 'phi3', 'mistral', 'codellama', 'mixtral'] },
  // ── 国内厂商 ──
  { id: 'moonshot', name: 'Moonshot AI（Kimi）', baseUrl: 'https://api.moonshot.cn/v1', models: ['kimi-k2.5', 'moonshot-v1-128k', 'moonshot-v1-32k', 'moonshot-v1-8k'] },
  { id: 'deepseek', name: '深度求索（DeepSeek）', baseUrl: 'https://api.deepseek.com/v1', models: ['deepseek-chat', 'deepseek-coder', 'deepseek-reasoner'] },
  { id: 'zhipu', name: '智谱 AI（GLM）', baseUrl: 'https://open.bigmodel.cn/api/paas/v4', models: ['glm-4-plus', 'glm-4', 'glm-4-flash', 'glm-4-long', 'codegeex-4'] },
  { id: 'qwen', name: '通义千问（百炼）', baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1', models: ['qwen-max', 'qwen-plus', 'qwen-turbo', 'qwen-coder-turbo', 'qwen-long'] },
  { id: 'ernie', name: '百度文心（ERNIE）', baseUrl: 'https://aip.baidubce.com/rpc/2.0/ai_custom/v1', models: ['ernie-4.0-turbo', 'ernie-4.0', 'ernie-3.5', 'ernie-speed', 'ernie-lite'] },
  { id: 'spark', name: '讯飞星火（Spark）', baseUrl: 'https://spark-api-open.xf-yun.com/v1', models: ['spark-max', 'spark-pro', 'spark-lite', 'spark-4-ultra'] },
  { id: 'minimax', name: 'MiniMax', baseUrl: 'https://api.minimax.chat/v1', models: ['abab7-chat', 'abab6.5s-chat', 'abab6.5-chat', 'abab5.5-chat'] },
  { id: 'hunyuan', name: '腾讯混元', baseUrl: 'https://api.hunyuan.cloud.tencent.com/v1', models: ['hunyuan-pro', 'hunyuan-standard', 'hunyuan-lite', 'hunyuan-code', 'hunyuan-vision'] },
  { id: 'doubao', name: '火山引擎（豆包）', baseUrl: 'https://ark.cn-beijing.volces.com/api/v3', models: ['doubao-pro-256k', 'doubao-pro-32k', 'doubao-pro-4k', 'doubao-lite-4k'] },
  { id: 'yi', name: '零一万物（Yi）', baseUrl: 'https://api.lingyiwanwu.com/v1', models: ['yi-lightning', 'yi-large', 'yi-medium', 'yi-spark', 'yi-large-turbo'] },
  { id: 'stepfun', name: '阶跃星辰（Step）', baseUrl: 'https://api.stepfun.com/v1', models: ['step-2-16k', 'step-1-256k', 'step-1-32k', 'step-1-8k', 'step-1v-8k'] },
  { id: 'baichuan', name: '百川智能', baseUrl: 'https://api.baichuan-ai.com/v1', models: ['Baichuan4', 'Baichuan3-Turbo', 'Baichuan2-Turbo'] },
  { id: 'tiangong', name: '昆仑万维（天工）', baseUrl: 'https://sky-api.singularity-ai.com/v1', models: ['SkyChat-MegaVerse'] },
  { id: 'sensetime', name: '商汤（日日新）', baseUrl: 'https://api.sensenova.cn/v1', models: ['SenseChat-5', 'SenseChat-Turbo', 'SenseChat-FunctionCall'] },
  { id: 'siliconflow', name: '硅基流动（SiliconFlow）', baseUrl: 'https://api.siliconflow.cn/v1', models: ['deepseek-ai/DeepSeek-V3', 'Qwen/Qwen2.5-72B-Instruct', 'meta-llama/Llama-3.1-70B-Instruct'] },
  // ── 海外厂商 ──
  { id: 'openai', name: 'OpenAI', baseUrl: 'https://api.openai.com/v1', models: ['gpt-4o', 'gpt-4o-mini', 'gpt-4-turbo', 'gpt-4.1', 'gpt-4.1-mini', 'o3-mini', 'gpt-3.5-turbo'] },
  { id: 'anthropic', name: 'Anthropic（Claude）', baseUrl: 'https://api.anthropic.com', models: ['claude-opus-4-20250514', 'claude-sonnet-4-20250514', 'claude-haiku-4-5-20251001'] },
  { id: 'google', name: 'Google（Gemini）', baseUrl: 'https://generativelanguage.googleapis.com/v1beta', models: ['gemini-2.5-pro', 'gemini-2.5-flash', 'gemini-2.0-flash', 'gemini-1.5-pro'] },
  { id: 'mistral', name: 'Mistral AI', baseUrl: 'https://api.mistral.ai/v1', models: ['mistral-large-latest', 'mistral-medium-latest', 'mistral-small-latest', 'codestral-latest', 'open-mixtral-8x22b'] },
  { id: 'xai', name: 'xAI（Grok）', baseUrl: 'https://api.x.ai/v1', models: ['grok-3', 'grok-3-mini', 'grok-2', 'grok-beta'] },
  { id: 'cohere', name: 'Cohere', baseUrl: 'https://api.cohere.com/v2', models: ['command-r-plus', 'command-r', 'command-light'] },
  { id: 'groq', name: 'Groq（极速推理）', baseUrl: 'https://api.groq.com/openai/v1', models: ['llama-3.3-70b-versatile', 'llama-3.1-8b-instant', 'mixtral-8x7b-32768', 'gemma2-9b-it'] },
  { id: 'together', name: 'Together AI', baseUrl: 'https://api.together.xyz/v1', models: ['meta-llama/Llama-3.3-70B-Instruct-Turbo', 'Qwen/Qwen2.5-72B-Instruct-Turbo', 'deepseek-ai/DeepSeek-R1'] },
  { id: 'perplexity', name: 'Perplexity', baseUrl: 'https://api.perplexity.ai', models: ['sonar-pro', 'sonar', 'sonar-reasoning'] },
  // ── 自定义 ──
  { id: 'custom', name: '自定义（OpenAI兼容）', baseUrl: '', models: [] },
];

const CODING_PROVIDERS = [
  { id: 'tencent-token', name: '腾讯云 Token Plan', baseUrl: 'https://api.hunyuan.cloud.tencent.com/v1', models: ['hunyuan-code', 'hunyuan-turbo'] },
  { id: 'tencent-coding', name: '腾讯云 Coding Plan', baseUrl: 'https://api.hunyuan.cloud.tencent.com/v1', models: ['hunyuan-code', 'hunyuan-pro'] },
  { id: 'qwen-coding', name: '百炼 Coding Plan', baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1', models: ['qwen-coder-turbo', 'qwen-coder-plus'] },
  { id: 'minimax-coding', name: 'MiniMax Coding Plan', baseUrl: 'https://api.minimax.chat/v1', models: ['abab7-chat', 'abab6.5-chat'] },
  { id: 'zhipu-coding', name: '智谱 AI Coding Plan', baseUrl: 'https://open.bigmodel.cn/api/paas/v4', models: ['codegeex-4', 'glm-4-flash'] },
  { id: 'doubao-coding', name: '方舟（火山引擎）Coding Plan', baseUrl: 'https://ark.cn-beijing.volces.com/api/v3', models: ['doubao-pro-4k'] },
  { id: 'kimi-coding', name: 'Kimi Coding Plan', baseUrl: 'https://api.moonshot.cn/v1', models: ['kimi-k2.5', 'moonshot-v1-8k'] },
  { id: 'baidu-coding', name: '百度千帆 Coding Plan', baseUrl: 'https://aip.baidubce.com/rpc/2.0/ai_custom/v1', models: ['ernie-4.0', 'ernie-speed'] },
  { id: 'spark-coding', name: '讯飞星火 Coding Plan', baseUrl: 'https://spark-api-open.xf-yun.com/v1', models: ['spark-max', 'spark-pro'] },
  { id: 'deepseek-coding', name: 'DeepSeek Coding Plan', baseUrl: 'https://api.deepseek.com/v1', models: ['deepseek-coder', 'deepseek-chat'] },
  { id: 'yi-coding', name: '零一万物 Coding Plan', baseUrl: 'https://api.lingyiwanwu.com/v1', models: ['yi-large', 'yi-medium'] },
  { id: 'siliconflow-coding', name: '硅基流动 Coding Plan', baseUrl: 'https://api.siliconflow.cn/v1', models: ['deepseek-ai/DeepSeek-V3', 'Qwen/Qwen2.5-Coder-32B-Instruct'] },
];

// ── Types ────────────────────────────────────────────────────────

export type ModelMode = 'default' | 'api' | 'coding';

export interface ModelConfig {
  mode: ModelMode;
  providerId: string;
  providerName: string;
  baseUrl: string;
  model: string;
  apiKey: string;
}

const DEFAULT_CONFIG: ModelConfig = {
  mode: 'default',
  providerId: '',
  providerName: '',
  baseUrl: '',
  model: '',
  apiKey: '',
};

export function loadModelConfig(): ModelConfig {
  try {
    return { ...DEFAULT_CONFIG, ...JSON.parse(localStorage.getItem('modelConfig') || '{}') };
  } catch {
    return DEFAULT_CONFIG;
  }
}

export function saveModelConfig(config: ModelConfig): void {
  localStorage.setItem('modelConfig', JSON.stringify(config));
}

// ── Component ────────────────────────────────────────────────────

interface Props {
  open: boolean;
  onClose: () => void;
  onSave: (config: ModelConfig) => void;
}

export function ModelSettings({ open, onClose, onSave }: Props) {
  const [config, setConfig] = useState<ModelConfig>(loadModelConfig);
  const [showKey, setShowKey] = useState(false);
  const [providerDropdownOpen, setProviderDropdownOpen] = useState(false);

  // Reset state when modal opens
  useEffect(() => {
    if (open) {
      setConfig(loadModelConfig());
      setShowKey(false);
      setProviderDropdownOpen(false);
    }
  }, [open]);

  const providers = config.mode === 'api' ? API_PROVIDERS : CODING_PROVIDERS;
  const selectedProvider = providers.find(p => p.id === config.providerId);
  const models = selectedProvider?.models || [];

  const handleModeChange = (mode: ModelMode) => {
    setConfig(prev => ({
      ...prev,
      mode,
      providerId: '',
      providerName: '',
      baseUrl: '',
      model: '',
      apiKey: mode === 'default' ? '' : prev.apiKey,
    }));
    setProviderDropdownOpen(false);
  };

  const handleProviderSelect = (provider: typeof API_PROVIDERS[0]) => {
    setConfig(prev => ({
      ...prev,
      providerId: provider.id,
      providerName: provider.name,
      baseUrl: provider.baseUrl,
      model: provider.models[0] || '',
    }));
    setProviderDropdownOpen(false);
  };

  const handleConfirm = () => {
    saveModelConfig(config);
    onSave(config);
    onClose();
  };

  const showCustomFields = config.mode === 'api' || config.mode === 'coding';

  return (
    <Modal open={open} onClose={onClose} title="" maxWidth="max-w-md">
      <div className="px-2">
        {/* Title */}
        <h2 className="text-xl font-bold mb-6">大模型设置</h2>

        {/* Radio options */}
        <div className="space-y-4 mb-6">
          {/* Default */}
          <label className="flex items-center gap-3 cursor-pointer group" onClick={() => handleModeChange('default')}>
            <div className={`w-6 h-6 rounded-full border-2 flex items-center justify-center transition ${config.mode === 'default' ? 'border-gray-900 dark:border-gray-100' : 'border-gray-300 dark:border-gray-600 group-hover:border-gray-400'}`}>
              {config.mode === 'default' && <div className="w-3.5 h-3.5 rounded-full bg-gray-900 dark:bg-gray-100" />}
            </div>
            <span className="text-base">默认大模型</span>
          </label>

          {/* Custom API */}
          <label className="flex items-center gap-3 cursor-pointer group" onClick={() => handleModeChange('api')}>
            <div className={`w-6 h-6 rounded-full border-2 flex items-center justify-center transition ${config.mode === 'api' ? 'border-gray-900 dark:border-gray-100' : 'border-gray-300 dark:border-gray-600 group-hover:border-gray-400'}`}>
              {config.mode === 'api' && <div className="w-3.5 h-3.5 rounded-full bg-gray-900 dark:bg-gray-100" />}
            </div>
            <span className="text-base">自定义大模型—模型API</span>
          </label>

          {/* Coding Plan */}
          <label className="flex items-center gap-3 cursor-pointer group" onClick={() => handleModeChange('coding')}>
            <div className={`w-6 h-6 rounded-full border-2 flex items-center justify-center transition ${config.mode === 'coding' ? 'border-gray-900 dark:border-gray-100' : 'border-gray-300 dark:border-gray-600 group-hover:border-gray-400'}`}>
              {config.mode === 'coding' && <div className="w-3.5 h-3.5 rounded-full bg-gray-900 dark:bg-gray-100" />}
            </div>
            <span className="text-base">自定义大模型—Coding Plan</span>
          </label>
        </div>

        {/* Custom fields (shown when api or coding selected) */}
        {showCustomFields && (
          <div className="space-y-5 mb-6 animate-in">
            {/* Provider selector */}
            <div>
              <label className="block text-sm font-semibold mb-2">模型厂商：</label>
              <div className="relative">
                <button
                  onClick={() => setProviderDropdownOpen(!providerDropdownOpen)}
                  className="w-full flex items-center justify-between px-4 py-3 rounded-full border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800 text-sm text-left hover:border-blue-300 dark:hover:border-blue-700 focus:border-blue-400 focus:ring-2 focus:ring-blue-100 dark:focus:ring-blue-900/30 transition"
                >
                  <span className={config.providerName ? 'text-gray-900 dark:text-gray-100' : 'text-gray-400'}>
                    {config.providerName || '请选择模型厂商'}
                  </span>
                  <svg className={`w-4 h-4 text-gray-400 transition ${providerDropdownOpen ? 'rotate-180' : ''}`} fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path d="M19 9l-7 7-7-7"/></svg>
                </button>

                {/* Dropdown */}
                {providerDropdownOpen && (
                  <div className="absolute z-50 mt-1 w-full bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-2xl shadow-lg max-h-72 overflow-y-auto">
                    {config.mode === 'api' && (
                      <div className="px-4 py-1.5 text-[10px] font-semibold text-gray-400 uppercase tracking-wider bg-gray-50 dark:bg-gray-800 rounded-t-2xl">本地模型</div>
                    )}
                    {providers.map((p, i) => {
                      // Insert section headers
                      const isDomesticStart = config.mode === 'api' && p.id === 'moonshot';
                      const isOverseasStart = config.mode === 'api' && p.id === 'openai';
                      const isCustomStart = config.mode === 'api' && p.id === 'custom';
                      return (
                        <div key={p.id}>
                          {isDomesticStart && <div className="px-4 py-1.5 text-[10px] font-semibold text-gray-400 uppercase tracking-wider bg-gray-50 dark:bg-gray-800">国内厂商</div>}
                          {isOverseasStart && <div className="px-4 py-1.5 text-[10px] font-semibold text-gray-400 uppercase tracking-wider bg-gray-50 dark:bg-gray-800">海外厂商</div>}
                          {isCustomStart && <div className="px-4 py-1.5 text-[10px] font-semibold text-gray-400 uppercase tracking-wider bg-gray-50 dark:bg-gray-800">自定义</div>}
                          <button
                            onClick={() => handleProviderSelect(p)}
                            className={`w-full text-left px-4 py-2.5 text-sm hover:bg-gray-50 dark:hover:bg-gray-800 transition ${config.providerId === p.id ? 'bg-blue-50 dark:bg-blue-900/20 text-blue-700 dark:text-blue-300' : ''} ${i === providers.length - 1 ? 'rounded-b-2xl' : ''}`}
                          >
                            {p.name}
                          </button>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            </div>

            {/* Custom base URL (only for custom provider) */}
            {config.providerId === 'custom' && (
              <div>
                <label className="block text-sm font-semibold mb-2">Base URL：</label>
                <input
                  type="text"
                  value={config.baseUrl}
                  onChange={e => setConfig(prev => ({ ...prev, baseUrl: e.target.value }))}
                  placeholder="https://your-api.com/v1"
                  className="w-full px-4 py-3 rounded-full border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800 text-sm focus:border-blue-400 focus:ring-2 focus:ring-blue-100 dark:focus:ring-blue-900/30 outline-none transition"
                />
              </div>
            )}

            {/* Model name */}
            <div>
              <label className="block text-sm font-semibold mb-2">模型名称：</label>
              {config.mode === 'coding' ? (
                /* Coding Plan: dropdown for model */
                <select
                  value={config.model}
                  onChange={e => setConfig(prev => ({ ...prev, model: e.target.value }))}
                  className="w-full px-4 py-3 rounded-full border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800 text-sm focus:border-blue-400 focus:ring-2 focus:ring-blue-100 dark:focus:ring-blue-900/30 outline-none transition appearance-none"
                >
                  <option value="" disabled>请选择模型名称</option>
                  {models.map(m => <option key={m} value={m}>{m}</option>)}
                </select>
              ) : (
                /* API mode: text input */
                <input
                  type="text"
                  value={config.model}
                  onChange={e => setConfig(prev => ({ ...prev, model: e.target.value }))}
                  placeholder="请输入模型名称"
                  className="w-full px-4 py-3 rounded-full border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800 text-sm focus:border-blue-400 focus:ring-2 focus:ring-blue-100 dark:focus:ring-blue-900/30 outline-none transition"
                />
              )}
            </div>

            {/* API Key */}
            <div>
              <label className="block text-sm font-semibold mb-2">API Key：</label>
              <div className="relative">
                <input
                  type={showKey ? 'text' : 'password'}
                  value={config.apiKey}
                  onChange={e => setConfig(prev => ({ ...prev, apiKey: e.target.value }))}
                  placeholder={config.providerId === 'ollama' ? '本地模型无需API Key（可留空）' : '请输入'}
                  className="w-full px-4 py-3 pr-12 rounded-full border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800 text-sm focus:border-blue-400 focus:ring-2 focus:ring-blue-100 dark:focus:ring-blue-900/30 outline-none transition"
                />
                <button
                  onClick={() => setShowKey(!showKey)}
                  className="absolute right-4 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 dark:hover:text-gray-300"
                  title={showKey ? '隐藏' : '显示'}
                >
                  {showKey ? (
                    <svg className="w-5 h-5" fill="none" stroke="currentColor" strokeWidth="1.5" viewBox="0 0 24 24"><path d="M2 12s3-7 10-7 10 7 10 7-3 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/></svg>
                  ) : (
                    <svg className="w-5 h-5" fill="none" stroke="currentColor" strokeWidth="1.5" viewBox="0 0 24 24"><path d="M17.94 17.94A10.07 10.07 0 0112 20c-7 0-11-8-11-8a18.45 18.45 0 015.06-5.94M9.9 4.24A9.12 9.12 0 0112 4c7 0 11 8 11 8a18.5 18.5 0 01-2.16 3.19m-6.72-1.07a3 3 0 11-4.24-4.24M1 1l22 22"/></svg>
                  )}
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Disclaimer */}
        <p className="text-xs text-gray-400 mb-6">
          *可选用自定义大模型配置，使用时请遵循相关法律法规
        </p>

        {/* Buttons */}
        <div className="flex gap-3">
          <button
            onClick={handleConfirm}
            className="flex-1 py-3 bg-gray-900 dark:bg-gray-100 text-white dark:text-gray-900 rounded-full text-sm font-medium hover:bg-gray-800 dark:hover:bg-gray-200 transition tracking-widest"
          >
            确 认
          </button>
          <button
            onClick={onClose}
            className="flex-1 py-3 border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-300 rounded-full text-sm font-medium hover:bg-gray-50 dark:hover:bg-gray-800 transition tracking-widest"
          >
            取 消
          </button>
        </div>
      </div>
    </Modal>
  );
}
