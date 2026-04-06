import { useState, useEffect, useCallback } from 'react';
import { loadModelConfig } from './ModelSettings';

interface CheckItem {
  label: string;
  status: 'ok' | 'error' | 'warn' | 'loading';
  detail: string;
}

export function EnvCheck() {
  const [items, setItems] = useState<CheckItem[]>([
    { label: '服务器运行中', status: 'loading', detail: '检查中...' },
    { label: '数据库', status: 'loading', detail: '检查中...' },
    { label: '大模型配置', status: 'loading', detail: '检查中...' },
    { label: '浏览器 (Chromium)', status: 'loading', detail: '检查中...' },
    { label: 'API 认证', status: 'loading', detail: '检查中...' },
  ]);

  const runChecks = useCallback(async () => {
    const results: CheckItem[] = [];

    // 1. Server health
    try {
      const res = await fetch('/health');
      const data = await res.json();

      const memMB = data.memory?.rss
        ? `${Math.round(data.memory.rss / 1024 / 1024)}MB`
        : data.memoryMB
          ? `${data.memoryMB}MB`
          : 'N/A';

      const uptimeStr = data.uptime
        ? data.uptime >= 3600
          ? `${Math.floor(data.uptime / 3600)}h ${Math.floor((data.uptime % 3600) / 60)}m`
          : `${Math.floor(data.uptime / 60)}m`
        : 'N/A';

      const nodeVersion = data.nodeVersion || data.node || '';

      results.push({
        label: '服务器运行中',
        status: 'ok',
        detail: `Online${nodeVersion ? ` · ${nodeVersion}` : ''} · ${memMB} · ${uptimeStr} uptime`,
      });

      // 2. Database
      const dbStatus = data.components?.database || data.database;
      if (dbStatus === 'ok' || dbStatus === true || data.db === 'ok') {
        results.push({ label: '数据库', status: 'ok', detail: 'SQLite OK' });
      } else if (dbStatus) {
        results.push({ label: '数据库', status: 'warn', detail: String(dbStatus) });
      } else {
        results.push({ label: '数据库', status: 'ok', detail: 'SQLite OK' });
      }

      // 3. LLM config
      const mc = loadModelConfig();
      if (mc.mode && mc.mode !== 'default' && mc.providerId) {
        results.push({
          label: '大模型配置',
          status: 'ok',
          detail: `${mc.providerName || mc.providerId} ${mc.model || ''}`.trim(),
        });
      } else if (data.llmConfigured === true) {
        results.push({ label: '大模型配置', status: 'ok', detail: '环境变量已配置' });
      } else {
        results.push({ label: '大模型配置', status: 'error', detail: '未配置 (请在模型设置中配置)' });
      }

      // 4. Browser / Chromium
      const browserOk = data.components?.browser || data.browser || data.chromium;
      if (browserOk === 'ok' || browserOk === true) {
        results.push({ label: '浏览器 (Chromium)', status: 'ok', detail: 'Browser available' });
      } else {
        results.push({ label: '浏览器 (Chromium)', status: 'warn', detail: '未检测到 (可选)' });
      }

      // 5. API auth
      const authEnabled = data.components?.auth || data.authEnabled;
      if (authEnabled === true || authEnabled === 'enabled') {
        results.push({ label: 'API 认证', status: 'ok', detail: '已启用' });
      } else {
        results.push({ label: 'API 认证', status: 'ok', detail: '已禁用 (开发模式)' });
      }
    } catch {
      results.push({ label: '服务器运行中', status: 'error', detail: '无法连接服务器' });
      results.push({ label: '数据库', status: 'error', detail: '无法检测' });

      const mc = loadModelConfig();
      if (mc.mode && mc.mode !== 'default' && mc.providerId) {
        results.push({
          label: '大模型配置',
          status: 'ok',
          detail: `${mc.providerName || mc.providerId} ${mc.model || ''}`.trim(),
        });
      } else {
        results.push({ label: '大模型配置', status: 'error', detail: '未配置' });
      }

      results.push({ label: '浏览器 (Chromium)', status: 'error', detail: '无法检测' });
      results.push({ label: 'API 认证', status: 'error', detail: '无法检测' });
    }

    setItems(results);
  }, []);

  useEffect(() => {
    runChecks();
  }, [runChecks]);

  const statusIcon = (s: CheckItem['status']) => {
    switch (s) {
      case 'ok': return <span className="text-green-500 flex-shrink-0">&#x2705;</span>;
      case 'error': return <span className="text-red-500 flex-shrink-0">&#x274C;</span>;
      case 'warn': return <span className="text-yellow-500 flex-shrink-0">&#x26A0;&#xFE0F;</span>;
      default: return <span className="text-gray-400 flex-shrink-0 animate-pulse">&#x23F3;</span>;
    }
  };

  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-sm font-semibold text-gray-700 dark:text-gray-300">
          系统检查 / System Check
        </h3>
        <button
          onClick={runChecks}
          className="text-xs text-blue-600 hover:text-blue-700 dark:text-blue-400 dark:hover:text-blue-300"
        >
          刷新
        </button>
      </div>
      <div className="space-y-2">
        {items.map((item, i) => (
          <div
            key={i}
            className="flex items-center gap-3 px-3 py-2 rounded-lg bg-gray-50 dark:bg-gray-800/50"
          >
            {statusIcon(item.status)}
            <span className="text-sm font-medium text-gray-800 dark:text-gray-200 min-w-[140px]">
              {item.label}
            </span>
            <span className="text-xs text-gray-500 dark:text-gray-400 truncate">
              {item.detail}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
