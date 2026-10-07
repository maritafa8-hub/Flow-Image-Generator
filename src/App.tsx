import React, { useState, useEffect, useRef } from 'react';
import JSZip from 'jszip';
import { 
  Download, 
  FileCode, 
  CheckCircle2, 
  Play, 
  Pause, 
  Square, 
  RotateCcw, 
  Upload, 
  Copy, 
  Check, 
  Layers, 
  Terminal, 
  HelpCircle,
  ExternalLink,
  Code2,
  Sparkles,
  Clock,
  Eye,
  AlertTriangle,
  Monitor,
  Trash2
} from 'lucide-react';
import { EXTENSION_FILES, EXTENSION_ICONS_BASE64 } from './extensionSource';

// Sample presets for quick testing
const PRESETS = {
  flower: [
    "A macro close-up of a vibrant blooming red rose with crystal water droplets, soft bokeh background, 8k cinematic lighting.",
    "A tranquil field of wild purple lavender glowing in golden sunset light, gentle warm breeze, photorealistic.",
    "Bioluminescent nocturnal lotus flower floating on calm dark pond water, neon turquoise and magenta glow.",
    "Delicate cherry blossom sakura branches against Mount Fuji at sunrise, soft pink petals drifting in the wind.",
    "A stunning white orchid flower in a modern minimalist ceramic vase, soft studio lighting, ultra-high detail.",
    "Vibrant yellow sunflower field under clear blue summer sky, hyper-detailed textures, warm sunlight.",
    "Close-up of a rare black dahlia flower with deep velvety crimson undertones, moody dramatic chiaroscuro lighting.",
    "A magical crystal tulip glowing with rainbow iridescence in an enchanted mystical garden, 3D render.",
    "Pastel peonies bouquet in a rustic glass jar on a vintage wooden windowsill, warm morning daylight.",
    "Exotic bird of paradise flower with sharp geometric petals in lush tropical rainforest, dew drops.",
    "Dandelion clock with glowing seeds catching the golden hour light and floating into the sky, cinematic macro.",
    "Soft pink water lily blooming in a Japanese koi pond, ripples reflecting azure sky, peaceful atmosphere.",
    "Winter frost-covered frozen blue rose with delicate ice crystals, ethereal soft blue and silver palette.",
    "Vibrant field of orange California poppies on rolling green hills during golden hour, wide angle lens.",
    "A solitary white edelweiss flower blooming on a rugged snowy alpine mountain cliff, dramatic sunlight.",
    "Glowing neon cyberpunk flower with glass petals and fiber-optic stamen, dark futuristic aesthetic.",
    "Bouquet of colorful spring ranunculus flowers with layered spiral petals, pastel color palette, soft focus.",
    "Deep blue Himalayan poppy blooming in misty high-altitude mountain forest, cinematic atmosphere.",
    "Magnificent blooming magnolia tree with massive porcelain white and pink blossoms in spring, sunny day.",
    "Enchanted forest carpet of glowing bluebells and forget-me-nots under dappled twilight canopy, fairy tale mood."
  ],
  cinematic: [
    "A photorealistic portrait of an ancient explorer holding an illuminated mechanical brass compass in an ethereal mist, 35mm photography, warm golden hour tones.",
    "A majestic snow-capped mountain range reflected in a glass-still alpine lake, cinematic composition, twilight purple hues, high detail.",
    "Futuristic greenhouse laboratory filled with bioluminescent crystalline flora, neon cyan and violet lighting, hyper-detailed render."
  ],
  multilingual: [
    "সূর্যাস্তের সময় শান্ত নদীর বুকে ঐতিহ্যবাহী কাঠের নৌকা, মনোরম দৃশ্য, সূক্ষ্ম আলোছায়া।",
    "A serene cyberpunk tea shop in old Tokyo under glowing rain, warm paper lanterns, reflections on wet cobblestones, 8k resolution.",
    "Golden eagle soaring through storm clouds with lightning flashes, dramatic volumetric rays, ultra-realistic 4K."
  ]
};

export default function App() {
  const [activeTab, setActiveTab] = useState<'simulator' | 'source' | 'install'>('simulator');
  const [selectedFile, setSelectedFile] = useState<string>('manifest.json');
  const [copiedFile, setCopiedFile] = useState<boolean>(false);
  const [isZipping, setIsZipping] = useState<boolean>(false);

  // SIMULATOR STATE - Matches user's exact screenshot (Flower Prompt List.txt, 20 prompts, 40s interval)
  const [prompts, setPrompts] = useState<string[]>(PRESETS.flower);
  const [initialBackup, setInitialBackup] = useState<string[]>(PRESETS.flower);
  const [completedCount, setCompletedCount] = useState<number>(0);
  const [fileName, setFileName] = useState<string>('Flower Prompt List.txt');
  const [intervalSeconds, setIntervalSeconds] = useState<number>(40);
  const [intervalUnit, setIntervalUnit] = useState<'seconds' | 'minutes'>('seconds');
  const [intervalValue, setIntervalValue] = useState<number>(40);
  
  const [previewMode, setPreviewMode] = useState<'extension' | 'split'>('extension');
  const [showLogs, setShowLogs] = useState<boolean>(false);
  
  // States: IDLE, RUNNING_STEP, WAITING_INTERVAL, PAUSED, STOPPED, COMPLETED, ERROR
  const [simState, setSimState] = useState<'IDLE' | 'RUNNING_STEP' | 'WAITING_INTERVAL' | 'PAUSED' | 'STOPPED' | 'COMPLETED' | 'ERROR'>('IDLE');
  const [statusText, setStatusText] = useState<string>('Ready');
  const [remainingTime, setRemainingTime] = useState<number | null>(null);
  const [simError, setSimError] = useState<string | null>(null);
  const [isPromptListCollapsed, setIsPromptListCollapsed] = useState<boolean>(false);

  // Simulated Google Flow Target Environment
  const [editorType, setEditorType] = useState<'textarea' | 'contenteditable'>('textarea');
  const [flowEditorContent, setFlowEditorContent] = useState<string>('');
  const [flowGoClickedCount, setFlowGoClickedCount] = useState<number>(0);
  const [isGoClickedAnim, setIsGoClickedAnim] = useState<boolean>(false);
  const [simLogs, setSimLogs] = useState<Array<{ time: string; text: string; type: 'info' | 'success' | 'warn' | 'error' }>>([
    { time: new Date().toLocaleTimeString(), text: 'Google Flow simulator environment ready.', type: 'info' }
  ]);

  const flowContentEditableRef = useRef<HTMLDivElement>(null);
  const countdownTimerRef = useRef<any>(null);

  // Sync refs to avoid stale closures in asynchronous callbacks
  const promptsRef = useRef<string[]>(prompts);
  const completedCountRef = useRef<number>(completedCount);
  const simStateRef = useRef<'IDLE' | 'RUNNING_STEP' | 'WAITING_INTERVAL' | 'PAUSED' | 'STOPPED' | 'COMPLETED' | 'ERROR'>(simState);
  const intervalSecondsRef = useRef<number>(intervalSeconds);
  const remainingTimeRef = useRef<number | null>(remainingTime);

  useEffect(() => {
    promptsRef.current = prompts;
  }, [prompts]);

  useEffect(() => {
    completedCountRef.current = completedCount;
  }, [completedCount]);

  useEffect(() => {
    simStateRef.current = simState;
  }, [simState]);

  useEffect(() => {
    intervalSecondsRef.current = intervalSeconds;
  }, [intervalSeconds]);

  useEffect(() => {
    remainingTimeRef.current = remainingTime;
  }, [remainingTime]);

  const addLog = (text: string, type: 'info' | 'success' | 'warn' | 'error' = 'info') => {
    const time = new Date().toLocaleTimeString();
    setSimLogs((prev) => [{ time, text, type }, ...prev.slice(0, 40)]);
  };

  // Synchronize simulated interval input
  const updateInterval = (val: number, unit: 'seconds' | 'minutes') => {
    setIntervalValue(val);
    setIntervalUnit(unit);
    const total = unit === 'minutes' ? Math.round(val * 60) : Math.round(val);
    setIntervalSeconds(total);
    intervalSecondsRef.current = total;
  };

  // ZIP download handler
  const handleDownloadZip = async () => {
    try {
      setIsZipping(true);
      const zip = new JSZip();

      // Add code files
      Object.entries(EXTENSION_FILES).forEach(([filename, content]) => {
        zip.file(filename, content);
      });

      // Add icons directory
      const iconsFolder = zip.folder('icons');
      if (iconsFolder) {
        Object.entries(EXTENSION_ICONS_BASE64).forEach(([iconPath, base64]) => {
          const rawPath = iconPath.replace('icons/', '');
          iconsFolder.file(rawPath, base64, { base64: true });
        });
      }

      const blob = await zip.generateAsync({ type: 'blob' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'flow-prompt-automator.zip';
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch (err) {
      console.error('Failed to generate zip:', err);
      setStatusText('Could not generate ZIP file.');
    } finally {
      setIsZipping(false);
    }
  };

  const handleCopyCode = () => {
    const content = EXTENSION_FILES[selectedFile as keyof typeof EXTENSION_FILES] || '';
    navigator.clipboard.writeText(content).then(() => {
      setCopiedFile(true);
      setTimeout(() => setCopiedFile(false), 2000);
    });
  };

  // Start the countdown timer between submissions
  const startIntervalCountdown = (totalSeconds: number) => {
    if (countdownTimerRef.current) {
      clearInterval(countdownTimerRef.current);
      countdownTimerRef.current = null;
    }

    setSimState('WAITING_INTERVAL');
    simStateRef.current = 'WAITING_INTERVAL';
    setRemainingTime(totalSeconds);
    remainingTimeRef.current = totalSeconds;

    countdownTimerRef.current = setInterval(() => {
      if (simStateRef.current !== 'WAITING_INTERVAL') {
        if (countdownTimerRef.current) {
          clearInterval(countdownTimerRef.current);
          countdownTimerRef.current = null;
        }
        return;
      }

      const current = remainingTimeRef.current;
      if (current === null || current <= 1) {
        if (countdownTimerRef.current) {
          clearInterval(countdownTimerRef.current);
          countdownTimerRef.current = null;
        }
        setRemainingTime(0);
        remainingTimeRef.current = 0;

        // Interval elapsed: Clear previous prompt completely right before pasting next
        addLog(`[Interval 00:00] Time reached! Clearing previous prompt completely from Flow box...`, 'info');
        setFlowEditorContent('');
        if (flowContentEditableRef.current) {
          flowContentEditableRef.current.innerText = '';
        }

        // Trigger next prompt submission cycle
        executeNextPrompt();
      } else {
        const next = current - 1;
        remainingTimeRef.current = next;
        setRemainingTime(next);
      }
    }, 1000);
  };

  // Execute a single prompt submission cycle
  const executeNextPrompt = async () => {
    if (countdownTimerRef.current) {
      clearInterval(countdownTimerRef.current);
      countdownTimerRef.current = null;
    }

    const currentQueue = [...promptsRef.current];
    const currentDone = completedCountRef.current;

    if (!currentQueue || currentQueue.length === 0) {
      setSimState('COMPLETED');
      simStateRef.current = 'COMPLETED';
      setStatusText(`Completed! All ${currentDone} prompts submitted. Queue is empty.`);
      setRemainingTime(null);
      remainingTimeRef.current = null;
      addLog(`All prompts cut & processed! Queue reached 0.`, 'success');
      return;
    }

    const promptText = currentQueue[0];
    const submitNumber = currentDone + 1;

    setSimState('RUNNING_STEP');
    simStateRef.current = 'RUNNING_STEP';
    setStatusText(`Submitting prompt #${submitNumber} (${currentQueue.length} remaining in queue)...`);
    setRemainingTime(null);
    remainingTimeRef.current = null;

    addLog(`[Step 1] Locating Google Flow prompt editor in dock...`, 'info');
    await new Promise((r) => setTimeout(r, 350));
    if ((simStateRef.current as any) === 'STOPPED') return;

    // Clear previous if any
    addLog(`[Step 2] Clearing prompt field and verifying empty state...`, 'info');
    setFlowEditorContent('');
    if (flowContentEditableRef.current) {
      flowContentEditableRef.current.innerText = '';
    }
    await new Promise((r) => setTimeout(r, 250));
    if ((simStateRef.current as any) === 'STOPPED') return;

    // Insert prompt
    addLog(`[Step 3] Pasting prompt #${submitNumber} (${promptText.length} chars)...`, 'info');
    setFlowEditorContent(promptText);
    if (flowContentEditableRef.current) {
      flowContentEditableRef.current.innerText = promptText;
    }
    await new Promise((r) => setTimeout(r, 250));
    if ((simStateRef.current as any) === 'STOPPED') return;

    // Verify
    addLog(`[Step 4] Verifying editor text matches prompt: MATCH CONFIRMED`, 'success');

    // Click GO
    addLog(`[Step 5] Clicking Google Flow GO / Submit button (→)...`, 'info');
    setIsGoClickedAnim(true);
    setFlowGoClickedCount((c) => c + 1);
    await new Promise((r) => setTimeout(r, 450));
    setIsGoClickedAnim(false);
    if ((simStateRef.current as any) === 'STOPPED') return;

    // CUT PROMPT FROM QUEUE!
    const updatedQueue = currentQueue.slice(1);
    const newDoneCount = currentDone + 1;

    promptsRef.current = updatedQueue;
    completedCountRef.current = newDoneCount;
    setPrompts(updatedQueue);
    setCompletedCount(newDoneCount);

    addLog(`✂️ [CUT FROM QUEUE] Prompt #${submitNumber} removed from list! Remaining in list: ${updatedQueue.length}`, 'warn');
    addLog(`[Step 6] GO clicked! Prompt kept visible in input field. Starting countdown.`, 'success');

    if (updatedQueue.length === 0) {
      setSimState('COMPLETED');
      simStateRef.current = 'COMPLETED';
      setStatusText(`Completed! All ${newDoneCount} prompts submitted. Queue empty.`);
      setRemainingTime(null);
      remainingTimeRef.current = null;
      addLog(`All prompts cut & processed. Queue reached 0.`, 'success');
      return;
    }

    // Start interval countdown
    setStatusText(`Submitted #${newDoneCount}. Queue: ${updatedQueue.length} left. Waiting countdown...`);
    startIntervalCountdown(intervalSecondsRef.current);
  };

  // Clean-up on unmount
  useEffect(() => {
    return () => {
      if (countdownTimerRef.current) {
        clearInterval(countdownTimerRef.current);
      }
    };
  }, []);

  // Controls
  const handleStart = () => {
    let queueToUse = promptsRef.current;
    let done = completedCountRef.current;

    if (simStateRef.current === 'COMPLETED' || !queueToUse || queueToUse.length === 0) {
      queueToUse = [...initialBackup];
      done = 0;
      promptsRef.current = queueToUse;
      completedCountRef.current = 0;
      setPrompts(queueToUse);
      setCompletedCount(0);
    }

    if (queueToUse.length === 0) {
      setStatusText('Please upload or select prompts first.');
      addLog('Cannot start: No prompts found in queue.', 'warn');
      return;
    }

    setSimError(null);
    addLog(`Starting automation with ${queueToUse.length} prompts in queue...`, 'info');
    executeNextPrompt();
  };

  const handlePause = () => {
    if (countdownTimerRef.current) {
      clearInterval(countdownTimerRef.current);
      countdownTimerRef.current = null;
    }
    setSimState('PAUSED');
    simStateRef.current = 'PAUSED';
    setStatusText('Paused');
    addLog(`Automation paused. Queue: ${promptsRef.current.length} prompts remaining. Countdown paused at ${remainingTimeRef.current}s.`, 'warn');
  };

  const handleResume = () => {
    if (simStateRef.current === 'PAUSED') {
      addLog(`[Resume] Clicking directly into prompt box (Illustrator-style focus arming)...`, 'info');
      if (flowContentEditableRef.current) {
        flowContentEditableRef.current.focus();
      }
      const secToResume = (remainingTimeRef.current != null && remainingTimeRef.current > 0)
        ? remainingTimeRef.current
        : intervalSecondsRef.current;
      addLog(`Automation resumed. Continuing countdown (${secToResume}s remaining)...`, 'info');
      startIntervalCountdown(secToResume);
    }
  };

  const handleStop = () => {
    if (countdownTimerRef.current) {
      clearInterval(countdownTimerRef.current);
      countdownTimerRef.current = null;
    }
    setSimState('STOPPED');
    simStateRef.current = 'STOPPED';
    setStatusText('Stopped');
    setRemainingTime(null);
    remainingTimeRef.current = null;
    addLog(`Automation stopped by user. Remaining ${promptsRef.current.length} prompts preserved in queue.`, 'warn');
  };

  const handleReset = () => {
    if (countdownTimerRef.current) {
      clearInterval(countdownTimerRef.current);
      countdownTimerRef.current = null;
    }
    const restored = [...initialBackup];
    promptsRef.current = restored;
    completedCountRef.current = 0;
    setPrompts(restored);
    setCompletedCount(0);
    setSimState('IDLE');
    simStateRef.current = 'IDLE';
    setStatusText(`Queue restored: ${restored.length} prompts ready.`);
    setRemainingTime(null);
    remainingTimeRef.current = null;
    setFlowEditorContent('');
    if (flowContentEditableRef.current) {
      flowContentEditableRef.current.innerText = '';
    }
    addLog(`Progress reset. Queue restored to ${initialBackup.length} prompts.`, 'info');
  };

  const handleCustomUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (event) => {
      const text = event.target?.result;
      if (typeof text !== 'string') return;
      const lines = text.split(/\r?\n/).map((l) => l.trim()).filter((l) => l.length > 0);
      if (lines.length === 0) {
        setStatusText('No prompts found in file.');
        addLog('Upload failed: File contains no prompt lines.', 'warn');
        return;
      }
      if (countdownTimerRef.current) {
        clearInterval(countdownTimerRef.current);
        countdownTimerRef.current = null;
      }
      setPrompts(lines);
      promptsRef.current = lines;
      setInitialBackup(lines);
      setCompletedCount(0);
      completedCountRef.current = 0;
      setFileName(file.name);
      setSimState('IDLE');
      simStateRef.current = 'IDLE';
      setRemainingTime(null);
      remainingTimeRef.current = null;
      setStatusText(`Loaded ${lines.length} prompts from ${file.name}`);
      addLog(`Uploaded ${file.name} with ${lines.length} prompts.`, 'success');
    };
    reader.readAsText(file, 'UTF-8');
    e.target.value = '';
  };

  const formatCountdown = (sec: number | null) => {
    if (sec === null || isNaN(sec)) return '--:--';
    const m = Math.floor(sec / 60);
    const s = Math.floor(sec % 60);
    return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  };

  // Manual click handler for the Google Flow GO button
  const handleManualGoClick = () => {
    setIsGoClickedAnim(true);
    setTimeout(() => setIsGoClickedAnim(false), 500);
    setFlowGoClickedCount((c) => c + 1);
    addLog('GO / Submit button clicked (→)', 'success');

    // If there is prompt text currently in the box
    if (flowEditorContent.trim()) {
      if (simStateRef.current === 'IDLE' || simStateRef.current === 'WAITING_INTERVAL' || simStateRef.current === 'STOPPED') {
        if (countdownTimerRef.current) {
          clearInterval(countdownTimerRef.current);
          countdownTimerRef.current = null;
        }
        const currentQueue = [...promptsRef.current];
        const currentDone = completedCountRef.current;
        const updatedQueue = currentQueue.slice(1);
        const newDoneCount = currentDone + 1;

        promptsRef.current = updatedQueue;
        completedCountRef.current = newDoneCount;
        setPrompts(updatedQueue);
        setCompletedCount(newDoneCount);

        addLog(`✂️ [CUT FROM QUEUE] Prompt submitted via GO button! Remaining: ${updatedQueue.length}`, 'warn');

        if (updatedQueue.length === 0) {
          setSimState('COMPLETED');
          simStateRef.current = 'COMPLETED';
          setStatusText(`Completed! All ${newDoneCount} prompts submitted. Queue empty.`);
          setRemainingTime(null);
          remainingTimeRef.current = null;
        } else {
          setStatusText(`Submitted #${newDoneCount}. Queue: ${updatedQueue.length} left. Waiting countdown...`);
          startIntervalCountdown(intervalSecondsRef.current);
        }
      }
    } else if (promptsRef.current.length > 0 && simStateRef.current === 'IDLE') {
      handleStart();
    }
  };

  // Manual handler to clear Google Flow prompt input box
  const handleClearPromptBox = () => {
    setFlowEditorContent('');
    if (flowContentEditableRef.current) {
      flowContentEditableRef.current.innerText = '';
    }
    addLog('🗑️ Google Flow prompt input field cleared.', 'info');
    setStatusText('Prompt field cleared.');
  };

  // Complete Clear: Clears all prompts from queue, resets counters, and empties prompt box
  const handleClearAllPrompts = () => {
    if (countdownTimerRef.current) {
      clearInterval(countdownTimerRef.current);
      countdownTimerRef.current = null;
    }
    setPrompts([]);
    promptsRef.current = [];
    setInitialBackup([]);
    setCompletedCount(0);
    completedCountRef.current = 0;
    setFileName('No file selected');
    setSimState('IDLE');
    simStateRef.current = 'IDLE';
    setRemainingTime(null);
    remainingTimeRef.current = null;
    setFlowEditorContent('');
    if (flowContentEditableRef.current) {
      flowContentEditableRef.current.innerText = '';
    }
    setStatusText('All prompts cleared. Queue is empty.');
    addLog('🗑️ All prompts cleared from list and Flow input field.', 'warn');
  };

  // Delete an individual prompt from the queue
  const handleDeletePrompt = (index: number) => {
    const updated = [...promptsRef.current];
    if (index >= 0 && index < updated.length) {
      const removed = updated.splice(index, 1)[0];
      promptsRef.current = updated;
      setPrompts(updated);
      addLog(`Removed prompt #${completedCount + index + 1} from queue.`, 'info');
      setStatusText(`Removed prompt. ${updated.length} remaining in queue.`);
    }
  };

  const renderExtensionCard = (isStandalone = false) => (
    <div className={`bg-[#131314] text-[#e3e3e3] flex flex-col font-sans ${
      isStandalone 
        ? 'w-full max-w-[480px] rounded-2xl border border-[#37393b] shadow-2xl overflow-hidden' 
        : 'w-full lg:w-[420px] xl:w-[460px] shrink-0 border-t lg:border-t-0 border-[#2d2f32]'
    }`}>
      {/* Side Panel Native Chrome Header */}
      <div className="bg-[#18191b] border-b border-[#2d2f32] px-4 py-2.5 flex items-center justify-between select-none">
        <div className="flex items-center gap-2">
          <span className="w-2.5 h-2.5 rounded-full bg-[#8ab4f8]"></span>
          <span className="text-xs font-semibold text-white tracking-wide">
            Flow Prompt Automator
          </span>
        </div>
        <div className="flex items-center gap-2 text-[#70757a]">
          <span className="text-xs cursor-pointer hover:text-white" title="Pin extension">📌</span>
          <span className="text-xs cursor-pointer hover:text-white font-bold" title="Close">✕</span>
        </div>
      </div>

      {/* Side Panel Content Body: Stretches full width to the right border */}
      <div className="p-4 sm:p-5 flex flex-col gap-3.5 flex-1 w-full box-border">
        {/* Top Header Row */}
        <div className="flex items-center justify-between w-full">
          <h2 className="text-xs font-bold tracking-wider uppercase text-white">
            FLOW PROMPT AUTOMATOR
          </h2>
          <div className="inline-flex items-center gap-1.5 text-[11px] px-2.5 py-0.5 rounded-full bg-[#1e1f20] border border-[#37393b] text-[#81c995]">
            <span className="w-1.5 h-1.5 rounded-full bg-[#81c995] animate-pulse"></span>
            Flow detected
          </div>
        </div>

        {/* TXT File Upload Box - Full Width */}
        <div className="flex flex-col gap-2 w-full">
          <label className="w-full bg-[#1e1f20] hover:bg-[#282a2c] border border-[#37393b] hover:border-[#4f5255] text-white text-xs font-semibold py-2.5 px-3 rounded-lg cursor-pointer flex items-center justify-center gap-2 transition shadow-sm">
            <Upload className="w-4 h-4 text-[#8ab4f8]" />
            Choose TXT File
            <input
              type="file"
              accept=".txt"
              onChange={handleCustomUpload}
              className="hidden"
            />
          </label>

          <div className="w-full flex items-center justify-between bg-[#1e1f20] border border-[#37393b] rounded-lg px-3.5 py-2.5 text-xs">
            <span className="truncate flex-1 min-w-0 pr-2 text-[#e3e3e3] font-medium" title={fileName}>{fileName}</span>
            <span className="text-[#8ab4f8] font-semibold text-[11px] bg-[#8ab4f8]/10 px-2.5 py-1 rounded border border-[#8ab4f8]/20 shrink-0">
              {prompts.length} left in queue
            </span>
          </div>
        </div>

        {/* INTERVAL Setting - Full Width */}
        <div className="flex flex-col gap-1.5 w-full">
          <label className="text-[11px] font-semibold text-[#9aa0a6] uppercase tracking-wider">
            INTERVAL
          </label>
          <div className="flex gap-2 w-full">
            <input
              type="number"
              min="1"
              max="3600"
              value={intervalValue}
              onChange={(e) => updateInterval(Math.max(1, parseInt(e.target.value) || 1), intervalUnit)}
              className="flex-1 min-w-0 bg-[#1e1f20] border border-[#37393b] focus:border-[#8ab4f8] rounded-lg px-3.5 py-2 text-xs text-white outline-none"
            />
            <select
              value={intervalUnit}
              onChange={(e) => updateInterval(intervalValue, e.target.value as any)}
              className="w-28 shrink-0 bg-[#1e1f20] border border-[#37393b] focus:border-[#8ab4f8] rounded-lg px-3 py-2 text-xs text-white outline-none cursor-pointer"
            >
              <option value="seconds">Seconds</option>
              <option value="minutes">Minutes</option>
            </select>
          </div>
          <span className="text-[10px] text-[#70757a]">
            Time to wait between submissions
          </span>
        </div>

        <div className="h-px bg-[#2d2f32] w-full"></div>

        {/* PROGRESS Section - Full Width */}
        <div className="flex flex-col gap-2 w-full">
          <div className="flex items-center justify-between text-xs w-full">
            <span className="text-[11px] font-semibold text-[#9aa0a6] uppercase tracking-wider">
              PROGRESS
            </span>
            <span className="font-semibold text-white font-mono">
              {completedCount} / {initialBackup.length}
            </span>
          </div>

          {/* Progress Bar Fill */}
          <div className="w-full h-2 bg-[#1e1f20] rounded-full overflow-hidden">
            <div
              className="h-full bg-[#8ab4f8] transition-all duration-300 rounded-full"
              style={{
                width: `${initialBackup.length > 0 ? (completedCount / initialBackup.length) * 100 : 0}%`
              }}
            ></div>
          </div>

          {/* Next Prompt in Countdown Ticker */}
          <div className="flex items-center justify-between text-xs pt-1 w-full">
            <span className="text-[#9aa0a6] text-[11px]">Next prompt in</span>
            <span className="font-bold text-[#8ab4f8] font-mono text-sm tracking-wide">
              {formatCountdown(remainingTime)}
            </span>
          </div>
        </div>

        {/* BUTTONS: Full Width */}
        <div className="flex flex-col gap-2.5 pt-1 w-full">
          {simState === 'PAUSED' ? (
            <button
              onClick={handleResume}
              className="w-full bg-[#8ab4f8] hover:bg-[#aecbfa] text-[#131314] font-bold text-xs py-2.5 px-3 rounded-lg transition shadow hover:scale-[1.01] active:scale-[0.99] cursor-pointer"
            >
              RESUME
            </button>
          ) : simState === 'RUNNING_STEP' || simState === 'WAITING_INTERVAL' ? (
            <button
              disabled
              className="w-full bg-[#8ab4f8]/60 text-[#131314] font-bold text-xs py-2.5 px-3 rounded-lg cursor-not-allowed animate-pulse"
            >
              RUNNING...
            </button>
          ) : (
            <button
              onClick={handleStart}
              className="w-full bg-[#8ab4f8] hover:bg-[#aecbfa] text-[#131314] font-bold text-xs py-2.5 px-3 rounded-lg transition shadow hover:scale-[1.01] active:scale-[0.99] cursor-pointer"
            >
              {simState === 'COMPLETED' ? 'RESTART' : 'START'}
            </button>
          )}

          <div className="grid grid-cols-2 gap-2.5 w-full">
            <button
              onClick={handlePause}
              disabled={simState !== 'RUNNING_STEP' && simState !== 'WAITING_INTERVAL'}
              className="w-full bg-[#1e1f20] hover:bg-[#282a2c] disabled:opacity-40 disabled:cursor-not-allowed text-white text-xs font-semibold py-2.5 px-3 rounded-lg border border-[#37393b] transition"
            >
              PAUSE
            </button>
            <button
              onClick={handleStop}
              disabled={simState === 'IDLE' || simState === 'COMPLETED'}
              className="w-full bg-red-500/10 hover:bg-red-500/20 disabled:opacity-40 disabled:cursor-not-allowed text-[#f28b82] text-xs font-semibold py-2.5 px-3 rounded-lg border border-red-500/30 transition"
            >
              STOP
            </button>
          </div>

          <div className="flex items-center justify-center gap-2 pt-1 w-full text-[11px] flex-wrap">
            <button
              type="button"
              onClick={handleClearAllPrompts}
              className="text-[#f28b82] hover:text-[#f6aea9] underline cursor-pointer flex items-center gap-1 transition font-medium"
              title="Clear all prompts from list"
            >
              <Trash2 className="w-3.5 h-3.5" />
              Clear List
            </button>
            <span className="text-[#37393b] select-none">•</span>
            <button
              type="button"
              onClick={handleClearPromptBox}
              className="text-[#9aa0a6] hover:text-[#8ab4f8] underline cursor-pointer flex items-center gap-1 transition"
              title="Clear current text in Google Flow box"
            >
              Clear Flow Box
            </button>
            <span className="text-[#37393b] select-none">•</span>
            <button
              type="button"
              onClick={handleReset}
              className="text-[#70757a] hover:text-[#9aa0a6] underline cursor-pointer transition"
              title="Reset progress back to prompt 1"
            >
              Reset Progress
            </button>
          </div>
        </div>

        <div className="h-px bg-[#2d2f32] w-full"></div>

        {/* PROMPT LIST SECTION (View & Manage Prompts) */}
        <div className="flex flex-col gap-2 w-full">
          <div className="flex items-center justify-between text-xs w-full">
            <div className="flex items-center gap-2">
              <span className="text-[11px] font-semibold text-[#9aa0a6] uppercase tracking-wider">
                PROMPT LIST
              </span>
              <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-[#8ab4f8]/10 text-[#8ab4f8] border border-[#8ab4f8]/20 font-mono">
                {prompts.length} left
              </span>
            </div>
            <button
              type="button"
              onClick={() => setIsPromptListCollapsed(!isPromptListCollapsed)}
              className="text-[11px] text-[#8ab4f8] hover:text-[#aecbfa] cursor-pointer font-medium"
            >
              {isPromptListCollapsed ? 'Show List' : 'Hide List'}
            </button>
          </div>

          {!isPromptListCollapsed && (
            <div className="w-full max-h-48 overflow-y-auto bg-[#18191b] border border-[#2d2f32] rounded-lg p-2 flex flex-col gap-1.5 custom-scrollbar">
              {prompts.length === 0 ? (
                <div className="text-center py-4 text-xs text-[#70757a]">
                  {completedCount > 0 ? (
                    <span className="text-emerald-400 font-medium">✓ All {completedCount} prompts submitted!</span>
                  ) : (
                    <span>No prompts in queue. Upload a TXT file above.</span>
                  )}
                </div>
              ) : (
                prompts.map((p, idx) => {
                  const serialNum = completedCount + idx + 1;
                  const isCurrentActive = idx === 0 && (simState === 'RUNNING_STEP' || simState === 'WAITING_INTERVAL');
                  const isNext = idx === 0 && !isCurrentActive;

                  return (
                    <div
                      key={idx}
                      className={`flex items-start gap-2 p-2 rounded text-xs transition border ${
                        isCurrentActive
                          ? 'bg-[#8ab4f8]/10 border-[#8ab4f8]/40 shadow-sm'
                          : 'bg-[#121315] border-transparent hover:border-[#37393b]'
                      }`}
                    >
                      <span className="font-mono text-[10px] text-[#70757a] shrink-0 mt-0.5 font-bold">
                        #{serialNum}
                      </span>
                      <div className="flex-1 min-w-0">
                        <p className={`line-clamp-2 text-[11px] leading-relaxed ${isCurrentActive ? 'text-white font-medium' : 'text-[#c4c7c5]'}`} title={p}>
                          {p}
                        </p>
                      </div>
                      <div className="flex items-center gap-1 shrink-0">
                        <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded uppercase tracking-wider ${
                          isCurrentActive
                            ? 'bg-[#8ab4f8] text-[#121314]'
                            : isNext
                            ? 'bg-amber-400/20 text-amber-300 border border-amber-400/30'
                            : 'bg-[#242629] text-[#70757a]'
                        }`}>
                          {isCurrentActive ? 'ACTIVE' : isNext ? 'NEXT' : 'QUEUED'}
                        </span>
                        <button
                          type="button"
                          onClick={() => handleDeletePrompt(idx)}
                          className="text-[#70757a] hover:text-[#f28b82] p-0.5 rounded cursor-pointer transition"
                          title="Delete prompt"
                        >
                          ✕
                        </button>
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          )}
        </div>

        <div className="h-px bg-[#2d2f32] w-full"></div>

        {/* STATUS Section: Full Width & Clean */}
        <div className="flex flex-col gap-1.5 pt-1 w-full bg-[#18191b] border border-[#2d2f32] p-3 rounded-lg">
          <span className="text-[10px] uppercase font-semibold text-[#70757a] tracking-wider">
            STATUS
          </span>
          <div className="text-xs text-white break-words font-medium">
            {simState === 'STOPPED' ? 'Stopped' : statusText}
          </div>
        </div>
      </div>
    </div>
  );

  return (
    <div className="min-h-screen bg-[#0e0f11] text-[#e3e3e3] flex flex-col font-sans">
      {/* Top Navigation Bar */}
      <header className="border-b border-[#282a2c] bg-[#131314] px-6 py-4 flex flex-wrap items-center justify-between gap-4 sticky top-0 z-50">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-lg bg-[#8ab4f8]/10 border border-[#8ab4f8]/30 flex items-center justify-center text-[#8ab4f8] shadow-inner">
            <Sparkles className="w-5 h-5" />
          </div>
          <div>
            <h1 className="text-base font-bold tracking-wide text-white flex items-center gap-2">
              FLOW PROMPT AUTOMATOR
              <span className="text-[10px] uppercase font-semibold px-2 py-0.5 rounded bg-[#8ab4f8]/15 text-[#8ab4f8] border border-[#8ab4f8]/30">
                Manifest V3
              </span>
            </h1>
            <p className="text-xs text-[#9aa0a6]">
              Production-ready Chrome Extension for Google Flow sequential automation
            </p>
          </div>
        </div>

        {/* View Switcher & Download Button */}
        <div className="flex items-center gap-3">
          <nav className="flex items-center bg-[#1e1f20] border border-[#37393b] rounded-lg p-1 text-xs">
            <button
              onClick={() => setActiveTab('simulator')}
              className={`px-3 py-1.5 rounded-md font-medium transition flex items-center gap-1.5 ${
                activeTab === 'simulator'
                  ? 'bg-[#282a2c] text-white shadow-sm'
                  : 'text-[#9aa0a6] hover:text-[#e3e3e3]'
              }`}
            >
              <Monitor className="w-3.5 h-3.5" />
              Live Interactive Simulator
            </button>
            <button
              onClick={() => setActiveTab('source')}
              className={`px-3 py-1.5 rounded-md font-medium transition flex items-center gap-1.5 ${
                activeTab === 'source'
                  ? 'bg-[#282a2c] text-white shadow-sm'
                  : 'text-[#9aa0a6] hover:text-[#e3e3e3]'
              }`}
            >
              <Code2 className="w-3.5 h-3.5" />
              Source Code Explorer
            </button>
            <button
              onClick={() => setActiveTab('install')}
              className={`px-3 py-1.5 rounded-md font-medium transition flex items-center gap-1.5 ${
                activeTab === 'install'
                  ? 'bg-[#282a2c] text-white shadow-sm'
                  : 'text-[#9aa0a6] hover:text-[#e3e3e3]'
              }`}
            >
              <HelpCircle className="w-3.5 h-3.5" />
              Chrome Install Guide
            </button>
          </nav>

          {/* 1-Click Unpacked ZIP Download */}
          <button
            onClick={handleDownloadZip}
            disabled={isZipping}
            className="bg-[#8ab4f8] hover:bg-[#aecbfa] text-[#131314] font-semibold text-xs px-4 py-2 rounded-lg flex items-center gap-2 shadow-sm transition hover:scale-[1.02] active:scale-[0.98] disabled:opacity-50"
          >
            <Download className="w-4 h-4" />
            {isZipping ? 'Packaging ZIP...' : 'Download Extension (.zip)'}
          </button>
        </div>
      </header>

      {/* Main Content Areas */}
      <main className="flex-1 p-4 lg:p-6 max-w-[1600px] mx-auto w-full">
        {/* Update Notification Banner */}
        <div className="mb-4 bg-[#1e232a] border border-[#2d4365] rounded-xl p-4 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 text-xs text-[#c2e7ff]">
          <div className="flex items-start gap-2.5">
            <span className="w-5 h-5 rounded-full bg-[#8ab4f8]/20 text-[#8ab4f8] flex items-center justify-center font-bold text-xs shrink-0 mt-0.5">✓</span>
            <div>
              <p className="font-semibold text-white text-sm">
                Google Flow রাইট অ্যারো (Right Arrow →) সাবমিট ও রিফ্রেশ সমস্যা সমাধান করা হয়েছে!
              </p>
              <p className="text-[#9aa0a6] mt-0.5 leading-relaxed">
                ১. প্রম্পট পেস্টের পর বৃত্তাকার রাইট অ্যারো বোতামটি এবং ব্যাকআপ হিসেবে Enter কি সফলভাবে ট্রিগার হচ্ছে।<br/>
                ২. রিফ্রেশ করার পর পুরানো এরর আটকে থাকা বন্ধ করা হয়েছে। নতুন কোড পেতে <strong>Download Extension (.zip)</strong> এ ক্লিক করে ক্রোমে আপডেট করুন।
              </p>
            </div>
          </div>
          <button
            onClick={handleDownloadZip}
            className="shrink-0 bg-[#8ab4f8] hover:bg-[#aecbfa] text-[#131314] font-semibold px-3 py-1.5 rounded-lg flex items-center gap-1.5 transition"
          >
            <Download className="w-3.5 h-3.5" />
            নতুন ZIP ডাউনলোড
          </button>
        </div>

        {/* TAB 1: LIVE SIMULATOR (Pixel-Perfect Google Flow + Chrome Side Panel Extension) */}
        {activeTab === 'simulator' && (
          <div className="space-y-4">
            {/* Control Bar: View Switcher, Presets, and Live Indicator */}
            <div className="bg-[#1e1f20] border border-[#37393b] rounded-xl p-3 flex flex-wrap items-center justify-between gap-3 text-xs">
              {/* View Mode Toggle */}
              <div className="flex items-center gap-1.5 bg-[#141517] p-1 rounded-lg border border-[#2d2f32]">
                <button
                  onClick={() => setPreviewMode('extension')}
                  className={`px-3 py-1.5 rounded-md font-medium transition flex items-center gap-1.5 ${
                    previewMode === 'extension'
                      ? 'bg-[#8ab4f8] text-[#131314] font-semibold shadow-sm'
                      : 'text-[#9aa0a6] hover:text-white'
                  }`}
                >
                  <Layers className="w-3.5 h-3.5" />
                  Extension View (রিয়েল এক্সটেনশন)
                </button>
                <button
                  onClick={() => setPreviewMode('split')}
                  className={`px-3 py-1.5 rounded-md font-medium transition flex items-center gap-1.5 ${
                    previewMode === 'split'
                      ? 'bg-[#8ab4f8] text-[#131314] font-semibold shadow-sm'
                      : 'text-[#9aa0a6] hover:text-white'
                  }`}
                >
                  <Monitor className="w-3.5 h-3.5" />
                  Google Flow + Side Panel (লাইভ টেস্ট)
                </button>
              </div>

              {/* Preset Selector */}
              <div className="flex items-center gap-2 flex-wrap">
                <span className="text-[#70757a] font-medium mr-1">Preset:</span>
                <button
                  onClick={() => {
                    if (countdownTimerRef.current) {
                      clearInterval(countdownTimerRef.current);
                      countdownTimerRef.current = null;
                    }
                    const list = [...PRESETS.flower];
                    setPrompts(list);
                    promptsRef.current = list;
                    setInitialBackup(list);
                    setCompletedCount(0);
                    completedCountRef.current = 0;
                    setFileName('Flower Prompt List.txt');
                    setIntervalValue(40);
                    setIntervalUnit('seconds');
                    setIntervalSeconds(40);
                    intervalSecondsRef.current = 40;
                    setSimState('IDLE');
                    simStateRef.current = 'IDLE';
                    setRemainingTime(null);
                    remainingTimeRef.current = null;
                    setFlowEditorContent('');
                    setStatusText('Ready');
                    addLog('Loaded Flower Prompt List.txt (20 prompts, 40s interval).', 'info');
                  }}
                  className={`px-3 py-1.5 rounded-md border transition font-medium ${
                    fileName === 'Flower Prompt List.txt'
                      ? 'bg-[#8ab4f8]/15 border-[#8ab4f8] text-[#8ab4f8]'
                      : 'bg-[#282a2c] hover:bg-[#37393b] border-[#37393b] text-[#e3e3e3]'
                  }`}
                >
                  🌸 Flower (20)
                </button>
                <button
                  onClick={() => {
                    if (countdownTimerRef.current) {
                      clearInterval(countdownTimerRef.current);
                      countdownTimerRef.current = null;
                    }
                    const list = [...PRESETS.cinematic];
                    setPrompts(list);
                    promptsRef.current = list;
                    setInitialBackup(list);
                    setCompletedCount(0);
                    completedCountRef.current = 0;
                    setFileName('cinematic-prompts.txt');
                    setSimState('IDLE');
                    simStateRef.current = 'IDLE';
                    setRemainingTime(null);
                    remainingTimeRef.current = null;
                    setFlowEditorContent('');
                    setStatusText('Ready');
                    addLog('Loaded cinematic preset prompts.', 'info');
                  }}
                  className={`px-3 py-1.5 rounded-md border transition font-medium ${
                    fileName === 'cinematic-prompts.txt'
                      ? 'bg-[#8ab4f8]/15 border-[#8ab4f8] text-[#8ab4f8]'
                      : 'bg-[#282a2c] hover:bg-[#37393b] border-[#37393b] text-[#e3e3e3]'
                  }`}
                >
                  🎬 Cinematic (3)
                </button>
                <button
                  onClick={() => {
                    if (countdownTimerRef.current) {
                      clearInterval(countdownTimerRef.current);
                      countdownTimerRef.current = null;
                    }
                    const list = [...PRESETS.multilingual];
                    setPrompts(list);
                    promptsRef.current = list;
                    setInitialBackup(list);
                    setCompletedCount(0);
                    completedCountRef.current = 0;
                    setFileName('multilingual-prompts.txt');
                    setSimState('IDLE');
                    simStateRef.current = 'IDLE';
                    setRemainingTime(null);
                    remainingTimeRef.current = null;
                    setFlowEditorContent('');
                    setStatusText('Ready');
                    addLog('Loaded multilingual (Bengali) preset prompts.', 'info');
                  }}
                  className={`px-3 py-1.5 rounded-md border transition font-medium ${
                    fileName === 'multilingual-prompts.txt'
                      ? 'bg-[#8ab4f8]/15 border-[#8ab4f8] text-[#8ab4f8]'
                      : 'bg-[#282a2c] hover:bg-[#37393b] border-[#37393b] text-[#e3e3e3]'
                  }`}
                >
                  🌐 Bengali (3)
                </button>
              </div>

              {/* Status Pill */}
              <div className="flex items-center gap-2">
                <span className={`px-2.5 py-1 rounded-full text-[11px] font-semibold border flex items-center gap-1.5 ${
                  simState === 'RUNNING_STEP'
                    ? 'bg-amber-400/10 text-amber-300 border-amber-400/30'
                    : simState === 'WAITING_INTERVAL'
                    ? 'bg-[#8ab4f8]/10 text-[#8ab4f8] border-[#8ab4f8]/30'
                    : simState === 'PAUSED'
                    ? 'bg-amber-400/10 text-amber-300 border-amber-400/30'
                    : 'bg-emerald-400/10 text-emerald-400 border-emerald-400/30'
                }`}>
                  <span className={`w-1.5 h-1.5 rounded-full ${
                    simState === 'RUNNING_STEP' || simState === 'WAITING_INTERVAL'
                      ? 'bg-[#8ab4f8] animate-ping'
                      : 'bg-emerald-400'
                  }`}></span>
                  {simState === 'RUNNING_STEP' ? 'Pasting & Submitting...' : simState === 'WAITING_INTERVAL' ? `Next: ${formatCountdown(remainingTime)}` : simState === 'PAUSED' ? 'Paused' : 'Ready'}
                </span>
              </div>
            </div>

            {/* VIEW MODE 1: PURE EXTENSION PREVIEW (Centered, Clean, No Clutter) */}
            {previewMode === 'extension' && (
              <div className="bg-[#121315] border border-[#2d2f32] rounded-2xl p-6 lg:p-8 flex flex-col items-center shadow-xl">
                <div className="w-full max-w-5xl flex flex-col lg:flex-row items-center lg:items-start justify-center gap-8">
                  {/* Extension Window */}
                  <div className="w-full max-w-[480px] flex flex-col items-center">
                    <div className="text-[11px] uppercase tracking-wider text-[#9aa0a6] font-semibold mb-2.5 flex items-center gap-1.5 self-start">
                      <span className="w-2 h-2 rounded-full bg-emerald-400"></span>
                      Chrome Extension Window
                    </div>
                    {renderExtensionCard(true)}
                  </div>

                  {/* Flow Connected Mirror Box */}
                  <div className="w-full max-w-md bg-[#18191b] border border-[#2d2f32] rounded-2xl p-5 shadow-2xl flex flex-col gap-4 self-center lg:self-start">
                    <div className="flex items-center justify-between border-b border-[#2d2f32] pb-3">
                      <div className="flex items-center gap-2">
                        <span className="w-2.5 h-2.5 rounded-full bg-gradient-to-tr from-amber-400 to-rose-400"></span>
                        <span className="text-xs font-semibold text-white">Google Flow (Connected Tab)</span>
                      </div>
                      <span className="text-[10px] text-emerald-400 bg-emerald-400/10 px-2 py-0.5 rounded-full border border-emerald-400/20 font-mono">
                        ● Live Connected
                      </span>
                    </div>

                    {/* Flow Prompt Input Area */}
                    <div className="bg-[#121315] border border-[#2a2c2f] rounded-xl p-3.5 flex flex-col gap-2.5 shadow-inner">
                      <div className="flex items-center justify-between text-[11px] text-[#9aa0a6]">
                        <span>Flow Prompt Input Box:</span>
                        <span className="text-xs font-mono text-[#8ab4f8]">
                          {flowEditorContent ? `${flowEditorContent.length} chars` : 'Empty (Waiting)'}
                        </span>
                      </div>

                      <div className="bg-[#1b1c1e] border border-[#37393b] rounded-lg p-3 min-h-[96px] flex flex-col justify-between">
                        <div className="text-xs sm:text-sm text-white font-sans whitespace-pre-wrap leading-relaxed select-text">
                          {flowEditorContent || (
                            <span className="text-[#555a60] italic text-xs">
                              What do you want to create? (START চাপলে এখান থেকে পেস্ট হবে)
                            </span>
                          )}
                        </div>

                        <div className="flex items-center justify-between pt-2 border-t border-[#26282b] mt-2">
                          <div className="flex items-center gap-2 text-xs text-[#70757a]">
                            <span className="px-2 py-0.5 rounded bg-[#242629]">🍌 Nano Banana 2</span>
                            <span>x1</span>
                          </div>

                          {/* Circular GO button with submit arrow */}
                          <div className="flex items-center gap-2">
                            <span className="text-[10px] text-[#70757a]">
                              GO clicks: <strong className="text-white">{flowGoClickedCount}</strong>
                            </span>
                            <button
                              type="button"
                              onClick={handleManualGoClick}
                              title="Click to Submit / Process Prompt"
                              className={`w-8 h-8 rounded-full flex items-center justify-center font-bold text-xs transition-all duration-200 cursor-pointer ${
                                isGoClickedAnim
                                  ? 'bg-[#8ab4f8] text-[#131314] ring-4 ring-[#8ab4f8]/50 scale-110 shadow-lg'
                                  : flowEditorContent.trim()
                                  ? 'bg-white hover:bg-neutral-200 text-black shadow-md hover:scale-105 active:scale-95'
                                  : 'bg-[#2a2c2f] text-[#70757a]'
                              }`}
                            >
                              {isGoClickedAnim ? '✓' : '→'}
                            </button>
                          </div>
                        </div>
                      </div>
                    </div>

                    {/* Real-Time Explanation */}
                    <div className="bg-[#141517] border border-[#26282b] rounded-xl p-3 text-xs space-y-1.5 text-[#9aa0a6] leading-relaxed">
                      <div className="font-semibold text-white flex items-center gap-1.5">
                        <span>🎯 নিখুঁত কার্যপ্রণালী:</span>
                      </div>
                      <p>
                        • <strong>START চাপলে:</strong> প্রম্পটটি লিস্ট থেকে সরাসরি <strong>কাট (Cut)</strong> হয়ে এখানে পেস্ট হয় এবং কিউ (Queue) থেকে কমে যায়।
                      </p>
                      <p>
                        • <strong>GO বাটনে (→) ক্লিক:</strong> স্বয়ংক্রিয়ভাবে ক্লিক সম্পন্ন হয়ে কাউন্টডাউন শুরু হয়।
                      </p>
                      <p>
                        • <strong>কাউন্টডাউন শেষে:</strong> ইনপুট বক্সটি ক্লিয়ার হয়ে পরবর্তী প্রম্পট পেস্ট হবে।
                      </p>
                    </div>
                  </div>
                </div>
              </div>
            )}

            {/* VIEW MODE 2: SPLIT SCREEN (Google Flow on Left + Side Panel on Right) */}
            {previewMode === 'split' && (
              <div className="bg-[#1f2023] border border-[#37393b] rounded-2xl overflow-hidden shadow-2xl flex flex-col">
                {/* 1. Authentic Chrome Browser Top Navigation Bar */}
                <div className="bg-[#1b1c1e] border-b border-[#2d2f32] px-3 py-2 flex items-center justify-between gap-4 select-none">
                  {/* Left: Window Dots & Active Chrome Tab */}
                  <div className="flex items-center gap-3">
                    <div className="flex items-center gap-1.5 px-1">
                      <span className="w-3 h-3 rounded-full bg-[#f28b82]/80"></span>
                      <span className="w-3 h-3 rounded-full bg-[#fdd663]/80"></span>
                      <span className="w-3 h-3 rounded-full bg-[#81c995]/80"></span>
                    </div>

                    {/* Chrome Tab */}
                    <div className="bg-[#000000] border-t border-x border-[#37393b] text-white text-xs px-3.5 py-1.5 rounded-t-lg flex items-center gap-2 max-w-xs shadow-sm font-sans">
                      <span className="w-2.5 h-2.5 rounded-full bg-gradient-to-tr from-amber-400 to-rose-400 shrink-0"></span>
                      <span className="truncate">flow.google.com/project</span>
                      <span className="text-[#70757a] hover:text-white text-[11px] ml-1">✕</span>
                    </div>
                  </div>

                  {/* Center: Real Chrome Address Bar */}
                  <div className="flex-1 max-w-2xl flex items-center gap-2">
                    <button 
                      onClick={() => {
                        addLog('Refreshed Flow page tab connection.', 'info');
                        setStatusText('Ready');
                      }}
                      title="Reload page"
                      className="p-1 rounded text-[#9aa0a6] hover:text-white hover:bg-[#282a2c] transition"
                    >
                      <RotateCcw className="w-3.5 h-3.5" />
                    </button>
                    <div className="flex-1 bg-[#131314] border border-[#2d2f32] rounded-full px-3 py-1 flex items-center gap-2 text-xs font-mono text-[#9aa0a6] shadow-inner">
                      <span className="text-emerald-400 text-xs">🔒</span>
                      <span className="text-white truncate">flow.google.com/project</span>
                    </div>
                  </div>

                  {/* Right: Chrome Extensions Bar with Side Panel Active Indicator */}
                  <div className="flex items-center gap-2 text-[#9aa0a6]">
                    <div className="flex items-center gap-1 text-xs px-2 py-0.5 rounded bg-[#2a2c2f] text-white border border-[#37393b]">
                      <span className="w-2 h-2 rounded-full bg-[#8ab4f8]"></span>
                      <span className="hidden md:inline text-[11px] font-medium">Side Panel Active</span>
                    </div>
                    <div className="w-7 h-7 rounded-full bg-[#8ab4f8]/20 border border-[#8ab4f8]/40 flex items-center justify-center text-[#8ab4f8] text-xs font-bold">
                      S
                    </div>
                  </div>
                </div>

                {/* 2. Main Viewport: Clean Google Flow (Left) + Chrome Side Panel (Right) */}
                <div className="flex flex-col lg:flex-row min-h-[580px] bg-[#000000]">
                  {/* LEFT: Clean Google Flow Web Application */}
                  <div className="flex-1 flex flex-col justify-between p-6 sm:p-8 relative bg-[#000000] border-r border-[#2d2f32]">
                    {/* Clean Google Flow Workspace Floor (No Floating Icons/Emoji on Floor) */}
                    <div className="my-auto flex flex-col items-center justify-center text-center select-none py-12">
                      <p className="text-sm font-medium text-[#70757a]">
                        Start creating or drop media
                      </p>
                    </div>

                    {/* Bottom Floating Prompt Dock: Exactly from screenshot */}
                    <div className="w-full max-w-2xl mx-auto flex flex-col items-center gap-2">
                      <div className="w-full bg-[#1b1c1e] border border-[#2e3134] rounded-2xl p-3 shadow-2xl flex flex-col gap-2 transition-all">
                        {/* Prompt Input Box: Clean, No Red Markers, Realistic Google Flow */}
                        <div className="w-full px-1">
                          {editorType === 'textarea' ? (
                            <textarea
                              rows={2}
                              value={flowEditorContent}
                              onChange={(e) => setFlowEditorContent(e.target.value)}
                              placeholder="What do you want to create?"
                              aria-label="What do you want to create?"
                              className="w-full bg-transparent text-sm text-white placeholder-[#70757a] resize-none outline-none font-sans leading-relaxed"
                            />
                          ) : (
                            <div
                              ref={flowContentEditableRef}
                              contentEditable
                              role="textbox"
                              aria-label="What do you want to create?"
                              data-placeholder="What do you want to create?"
                              onInput={(e) => setFlowEditorContent((e.target as any).innerText)}
                              className="w-full min-h-[48px] bg-transparent text-sm text-white placeholder-[#70757a] outline-none font-sans whitespace-pre-wrap leading-relaxed"
                            />
                          )}
                        </div>

                        {/* Bottom Toolbar inside the Dock */}
                        <div className="flex items-center justify-between pt-1 border-t border-[#26282b]">
                          {/* Left Dock Controls */}
                          <div className="flex items-center gap-2">
                            <button
                              type="button"
                              className="w-7 h-7 rounded-full bg-[#242629] text-[#9aa0a6] hover:text-white flex items-center justify-center text-sm font-bold transition hover:bg-[#303337]"
                            >
                              +
                            </button>
                            <button
                              type="button"
                              className="px-3 py-1 rounded-full bg-[#242629] text-xs text-[#9aa0a6] hover:text-white font-medium transition hover:bg-[#303337]"
                            >
                              Agent
                            </button>
                          </div>

                          {/* Right Dock Controls: Model & Circular Submit Button */}
                          <div className="flex items-center gap-2.5">
                            <div className="px-3 py-1 rounded-full bg-[#242629] text-xs text-[#9aa0a6] flex items-center gap-1.5 select-none">
                              <span>🍌 Nano Banana 2</span>
                              <span className="text-[#70757a]">x1</span>
                            </div>

                            {/* Circular Submit Button */}
                            <button
                              type="button"
                              aria-label="Submit Prompt (GO)"
                              onClick={handleManualGoClick}
                              className={`w-8 h-8 rounded-full flex items-center justify-center transition-all duration-200 font-bold text-sm ${
                                isGoClickedAnim
                                  ? 'bg-[#8ab4f8] text-[#131314] ring-4 ring-[#8ab4f8]/50 scale-110 shadow-lg'
                                  : flowEditorContent.trim()
                                  ? 'bg-white hover:bg-neutral-200 text-black cursor-pointer shadow-md hover:scale-105 active:scale-90'
                                  : 'bg-[#2a2c2f] text-[#70757a] cursor-pointer hover:bg-[#35383c]'
                              }`}
                            >
                              {isGoClickedAnim ? '✓' : '→'}
                            </button>
                          </div>
                        </div>
                      </div>

                      {/* Google Flow Disclaimer */}
                      <p className="text-[11px] text-[#555a60]">
                        Google Flow can make mistakes, so double-check it
                      </p>
                    </div>
                  </div>

                {/* RIGHT (approx 28%): Authentic Chrome Side Panel Extension */}
                {renderExtensionCard(false)}
              </div>
            </div>
          )}

            {/* Collapsible Technical Logs Drawer (Clean & Hidden by Default) */}
            <div className="border border-[#282a2c] bg-[#141517] rounded-xl overflow-hidden text-xs">
              <button
                onClick={() => setShowLogs(!showLogs)}
                className="w-full px-4 py-2.5 text-[#9aa0a6] hover:text-white flex items-center justify-between transition hover:bg-[#1a1b1d]"
              >
                <span className="flex items-center gap-2 font-medium">
                  <Terminal className="w-3.5 h-3.5 text-[#8ab4f8]" />
                  Real-Time Content Script & Service Worker Logs ({simLogs.length} events)
                </span>
                <span className="text-[11px] text-[#70757a]">
                  {showLogs ? '▲ Hide Logs' : '▼ Show Logs'}
                </span>
              </button>
              {showLogs && (
                <div className="p-3 bg-[#0a0a0b] border-t border-[#242528] max-h-44 overflow-y-auto font-mono text-[11px] space-y-1">
                  {simLogs.map((log, i) => (
                    <div key={i} className="flex items-start gap-2 leading-relaxed">
                      <span className="text-[#555a60] shrink-0">[{log.time}]</span>
                      <span
                        className={
                          log.type === 'success'
                            ? 'text-emerald-400'
                            : log.type === 'warn'
                            ? 'text-amber-400'
                            : log.type === 'error'
                            ? 'text-red-400'
                            : 'text-[#8ab4f8]'
                        }
                      >
                        [Flow Automator]
                      </span>
                      <span className="text-[#d0d3d6]">{log.text}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}

        {/* TAB 2: COMPLETE SOURCE CODE EXPLORER */}
        {activeTab === 'source' && (
          <div className="grid grid-cols-1 md:grid-cols-12 gap-6">
            {/* File List */}
            <div className="md:col-span-3 space-y-2">
              <span className="text-xs font-semibold text-[#9aa0a6] uppercase tracking-wider block">
                Extension Files
              </span>
              <div className="bg-[#161719] border border-[#2b2d30] rounded-xl overflow-hidden divide-y divide-[#242629]">
                {Object.keys(EXTENSION_FILES).map((fileKey) => (
                  <button
                    key={fileKey}
                    onClick={() => setSelectedFile(fileKey)}
                    className={`w-full text-left px-3.5 py-3 text-xs font-mono transition flex items-center justify-between ${
                      selectedFile === fileKey
                        ? 'bg-[#8ab4f8]/10 text-[#8ab4f8] font-semibold border-l-2 border-[#8ab4f8]'
                        : 'text-[#9aa0a6] hover:bg-[#1e1f20] hover:text-white'
                    }`}
                  >
                    <span>{fileKey}</span>
                    <FileCode className="w-3.5 h-3.5 opacity-60" />
                  </button>
                ))}
              </div>

              <div className="p-3 bg-[#161719] border border-[#2b2d30] rounded-xl text-xs text-[#9aa0a6] space-y-2">
                <span className="font-semibold text-white block">Manifest V3 Assets</span>
                <p className="text-[11px] text-[#70757a]">
                  Includes all high-resolution extension icons (16px, 32px, 48px, 128px) bundled directly in the ZIP download.
                </p>
              </div>
            </div>

            {/* Code Viewer */}
            <div className="md:col-span-9 flex flex-col gap-2">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <span className="text-xs font-mono text-[#8ab4f8] bg-[#8ab4f8]/10 px-2.5 py-1 rounded border border-[#8ab4f8]/20">
                    {selectedFile}
                  </span>
                  <span className="text-xs text-[#70757a]">
                    {(EXTENSION_FILES[selectedFile as keyof typeof EXTENSION_FILES] || '').split('\n').length} lines
                  </span>
                </div>

                <button
                  onClick={handleCopyCode}
                  className="bg-[#1e1f20] hover:bg-[#282a2c] text-white text-xs px-3 py-1.5 rounded-lg border border-[#37393b] flex items-center gap-1.5 transition"
                >
                  {copiedFile ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
                  {copiedFile ? 'Copied to Clipboard' : 'Copy File'}
                </button>
              </div>

              <div className="bg-[#121316] border border-[#2b2d30] rounded-xl p-4 font-mono text-xs overflow-x-auto text-[#e3e3e3] leading-relaxed shadow-inner max-h-[600px] select-text">
                <pre>{EXTENSION_FILES[selectedFile as keyof typeof EXTENSION_FILES]}</pre>
              </div>
            </div>
          </div>
        )}

        {/* TAB 3: STEP-BY-STEP CHROME INSTALLATION GUIDE */}
        {activeTab === 'install' && (
          <div className="max-w-4xl mx-auto space-y-6">
            <div className="bg-[#1e1f20] border border-[#37393b] rounded-xl p-6">
              <h2 className="text-lg font-bold text-white mb-2 flex items-center gap-2">
                <CheckCircle2 className="w-5 h-5 text-[#8ab4f8]" />
                Installing Flow Prompt Automator in Google Chrome
              </h2>
              <p className="text-sm text-[#9aa0a6] leading-relaxed">
                Because this extension uses Chrome Manifest V3 with specialized background workers and content scripts, you can load it in less than 30 seconds via Chrome's built-in Developer Mode.
              </p>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {/* Step 1 */}
              <div className="bg-[#161719] border border-[#2b2d30] rounded-xl p-5 space-y-2">
                <div className="flex items-center gap-2">
                  <span className="w-6 h-6 rounded-full bg-[#8ab4f8] text-[#131314] font-bold text-xs flex items-center justify-center">
                    1
                  </span>
                  <h3 className="text-sm font-semibold text-white">Download & Extract ZIP</h3>
                </div>
                <p className="text-xs text-[#9aa0a6] leading-relaxed">
                  Click the <strong>"Download Extension (.zip)"</strong> button at the top right of this page. Extract the downloaded <code className="text-[#8ab4f8] bg-[#1e1f20] px-1 py-0.5 rounded">flow-prompt-automator.zip</code> to a folder on your computer.
                </p>
              </div>

              {/* Step 2 */}
              <div className="bg-[#161719] border border-[#2b2d30] rounded-xl p-5 space-y-2">
                <div className="flex items-center gap-2">
                  <span className="w-6 h-6 rounded-full bg-[#8ab4f8] text-[#131314] font-bold text-xs flex items-center justify-center">
                    2
                  </span>
                  <h3 className="text-sm font-semibold text-white">Open Chrome Extensions</h3>
                </div>
                <p className="text-xs text-[#9aa0a6] leading-relaxed">
                  In Chrome, open a new tab and go to <code className="text-[#8ab4f8] bg-[#1e1f20] px-1 py-0.5 rounded">chrome://extensions/</code> (or click the three dots ⋮ → Extensions → Manage Extensions).
                </p>
              </div>

              {/* Step 3 */}
              <div className="bg-[#161719] border border-[#2b2d30] rounded-xl p-5 space-y-2">
                <div className="flex items-center gap-2">
                  <span className="w-6 h-6 rounded-full bg-[#8ab4f8] text-[#131314] font-bold text-xs flex items-center justify-center">
                    3
                  </span>
                  <h3 className="text-sm font-semibold text-white">Enable Developer Mode</h3>
                </div>
                <p className="text-xs text-[#9aa0a6] leading-relaxed">
                  In the top-right corner of the Extensions page, toggle the <strong>Developer mode</strong> switch to <strong>ON</strong>.
                </p>
              </div>

              {/* Step 4 */}
              <div className="bg-[#161719] border border-[#2b2d30] rounded-xl p-5 space-y-2">
                <div className="flex items-center gap-2">
                  <span className="w-6 h-6 rounded-full bg-[#8ab4f8] text-[#131314] font-bold text-xs flex items-center justify-center">
                    4
                  </span>
                  <h3 className="text-sm font-semibold text-white">Load Unpacked</h3>
                </div>
                <p className="text-xs text-[#9aa0a6] leading-relaxed">
                  Click the <strong>"Load unpacked"</strong> button in the top-left toolbar, then select the extracted <code className="text-[#8ab4f8] bg-[#1e1f20] px-1 py-0.5 rounded">flow-prompt-automator</code> folder.
                </p>
              </div>
            </div>

            {/* How to Run Card */}
            <div className="bg-[#161719] border border-[#2b2d30] rounded-xl p-6 space-y-4">
              <h3 className="text-sm font-semibold text-white flex items-center gap-2">
                <Play className="w-4 h-4 text-[#8ab4f8]" />
                How to Automate Prompts in Google Flow
              </h3>
              <ol className="list-decimal list-inside space-y-2 text-xs text-[#9aa0a6] leading-relaxed">
                <li>
                  Open <strong>Google Flow</strong> in a Chrome tab and make sure you are signed in.
                </li>
                <li>
                  Click the <strong>Flow Prompt Automator</strong> icon in your browser toolbar (pin it from the puzzle icon for easy access).
                </li>
                <li>
                  Click <strong>"Choose TXT File"</strong> and select your prompt list. Empty lines are ignored; Unicode/punctuation is 100% preserved.
                </li>
                <li>
                  Set your desired <strong>Interval</strong> (e.g. 2 minutes).
                </li>
                <li>
                  Click <strong>START</strong>. The extension automatically inserts Prompt 1, verifies it, clicks GO, keeps the prompt in the box during the interval, completely deletes it after the interval, verifies empty state, and inserts Prompt 2!
                </li>
              </ol>
            </div>

            {/* DevTools Inspection Tips */}
            <div className="bg-[#161719] border border-[#2b2d30] rounded-xl p-6 space-y-3">
              <h3 className="text-sm font-semibold text-white flex items-center gap-2">
                <Terminal className="w-4 h-4 text-emerald-400" />
                How to View Debug Logs in Chrome DevTools
              </h3>
              <ul className="space-y-2 text-xs text-[#9aa0a6]">
                <li className="flex items-start gap-2">
                  <span className="text-emerald-400 font-bold">•</span>
                  <span>
                    <strong>On the Google Flow page:</strong> Press <code className="bg-[#1e1f20] px-1 py-0.5 rounded text-white font-mono">F12</code> or <code className="bg-[#1e1f20] px-1 py-0.5 rounded text-white font-mono">Ctrl+Shift+I</code> to open Console and see real-time DOM detection and verification logs tagged with <code className="text-[#8ab4f8] font-mono">[Flow Automator]</code>.
                  </span>
                </li>
                <li className="flex items-start gap-2">
                  <span className="text-emerald-400 font-bold">•</span>
                  <span>
                    <strong>On the Service Worker:</strong> In <code className="bg-[#1e1f20] px-1 py-0.5 rounded text-white font-mono">chrome://extensions/</code>, click <strong>"service worker"</strong> under Flow Prompt Automator to view background alarms, lifecycle events, and minimized-window scheduler events.
                  </span>
                </li>
              </ul>
            </div>
          </div>
        )}
      </main>
    </div>
  );
}
