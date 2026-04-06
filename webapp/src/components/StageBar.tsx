import { useEffect, useState } from 'react';
import { useApp } from '../context/AppContext';
import type { Stage } from '../types';

const STAGES: { key: Stage; label: string }[] = [
  { key: 'planning', label: 'Planning' },
  { key: 'executing', label: 'Executing' },
  { key: 'verifying', label: 'Verifying' },
  { key: 'done', label: 'Done' },
];

function pillClass(current: Stage, pill: Stage): string {
  const order: Stage[] = ['planning', 'executing', 'verifying', 'done'];
  const ci = order.indexOf(current);
  const pi = order.indexOf(pill);

  if (ci < 0) return 'bg-gray-100 dark:bg-gray-800 text-gray-500';
  if (pi === ci) return 'bg-blue-100 dark:bg-blue-900 text-blue-700 dark:text-blue-300 ring-1 ring-blue-400';
  if (pi < ci) return 'bg-green-100 dark:bg-green-900 text-green-700 dark:text-green-300';
  return 'bg-gray-100 dark:bg-gray-800 text-gray-500';
}

function progressWidth(stage: Stage): string {
  switch (stage) {
    case 'planning': return '15%';
    case 'executing': return '50%';
    case 'verifying': return '80%';
    case 'done': return '100%';
    default: return '0%';
  }
}

function formatElapsed(ms: number): string {
  const totalSec = Math.floor(ms / 1000);
  if (totalSec < 60) return `${totalSec}s`;
  const m = Math.floor(totalSec / 60);
  const s = totalSec % 60;
  return `${m}:${s.toString().padStart(2, '0')}s`;
}

export function StageBar() {
  const { state } = useApp();
  const { stage, tasksDone, tasksTotal, stageStartTime } = state;
  const [elapsed, setElapsed] = useState(0);

  useEffect(() => {
    if (!stageStartTime || stage === 'idle') {
      setElapsed(0);
      return;
    }

    setElapsed(Date.now() - stageStartTime);
    const timer = setInterval(() => {
      setElapsed(Date.now() - stageStartTime);
    }, 1000);

    return () => clearInterval(timer);
  }, [stageStartTime, stage]);

  if (stage === 'idle') return null;

  return (
    <div className="pb-2">
      <div className="flex items-center gap-1 mb-1">
        {STAGES.map((s, i) => (
          <span key={s.key} className="contents">
            {i > 0 && (
              <span className="text-gray-300 dark:text-gray-700 text-xs">&rarr;</span>
            )}
            <span className={`stage-pill ${pillClass(stage, s.key)}`}>
              {s.label}
            </span>
          </span>
        ))}

        <span className="ml-auto flex items-center gap-3 text-xs text-gray-400 mono">
          {tasksTotal > 0 && (
            <span>{tasksDone}/{tasksTotal} tasks</span>
          )}
          <span>{formatElapsed(elapsed)}</span>
        </span>
      </div>

      <div className="w-full bg-gray-200 dark:bg-gray-800 rounded-full h-[3px] overflow-hidden">
        <div
          className="progress-track bg-blue-500 h-full rounded-full"
          style={{ width: progressWidth(stage) }}
        />
      </div>
    </div>
  );
}
