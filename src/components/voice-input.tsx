import { cn } from "@/lib/utils";
import { Mic, MicOff } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";

// Web Speech API — not fully typed in TypeScript's DOM lib
interface SpeechRecognitionEvent extends Event {
  readonly results: SpeechRecognitionResultList;
}

interface SpeechRecognitionErrorEvent extends Event {
  readonly error: string;
}

interface SpeechRecog extends EventTarget {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  onresult: ((event: SpeechRecognitionEvent) => void) | null;
  onend: ((event: Event) => void) | null;
  onerror: ((event: SpeechRecognitionErrorEvent) => void) | null;
  start(): void;
  stop(): void;
  abort(): void;
}

type SpeechRecogCtor = new () => SpeechRecog;

const RecognitionAPI: SpeechRecogCtor | undefined =
  typeof window !== "undefined"
    ? // biome-ignore lint/suspicious/noExplicitAny: SpeechRecognition / webkitSpeechRecognition not in DOM types
      ((window as any).SpeechRecognition ?? (window as any).webkitSpeechRecognition)
    : undefined;

function useSpeechInput(value: string, onChange: (v: string) => void) {
  const [isListening, setIsListening] = useState(false);
  const recogRef = useRef<SpeechRecog | null>(null);
  const baseRef = useRef("");
  const finalRef = useRef("");
  // Ref so recognition callbacks always call the latest onChange without needing it
  // as a dependency (avoids re-creating the recognition instance on every keystroke)
  const onChangeRef = useRef(onChange);
  useEffect(() => {
    onChangeRef.current = onChange;
  });

  const stop = useCallback(() => {
    recogRef.current?.stop();
  }, []);

  const start = useCallback(() => {
    if (!RecognitionAPI) return;
    // Snapshot the field value at the moment recording begins
    baseRef.current = value;
    finalRef.current = "";

    const recog = new RecognitionAPI();
    recog.continuous = true;
    recog.interimResults = true;
    recog.lang = navigator.language || "en-US";

    recog.onresult = (event) => {
      let finalText = "";
      let interimText = "";
      for (let i = 0; i < event.results.length; i++) {
        const t = event.results[i][0].transcript;
        if (event.results[i].isFinal) finalText += t;
        else interimText += t;
      }
      finalRef.current = finalText;
      const base = baseRef.current;
      const sep = base.trimEnd() ? " " : "";
      onChangeRef.current(base + sep + finalText + interimText);
    };

    recog.onend = () => {
      // Commit only confirmed finals; drop any trailing interim text
      const base = baseRef.current;
      const final = finalRef.current;
      const sep = base.trimEnd() && final ? " " : "";
      onChangeRef.current(base + sep + final);
      setIsListening(false);
      recogRef.current = null;
    };

    recog.onerror = (event) => {
      if (event.error !== "aborted") {
        console.warn("SpeechRecognition error:", event.error);
      }
    };

    recogRef.current = recog;
    recog.start();
    setIsListening(true);
    // value is intentionally captured at call-time as the base snapshot
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);

  const toggle = useCallback(() => {
    if (isListening) stop();
    else start();
  }, [isListening, stop, start]);

  useEffect(() => {
    return () => {
      recogRef.current?.abort();
    };
  }, []);

  return { isListening, toggle, supported: !!RecognitionAPI };
}

export function MicButton({
  value,
  onChange,
  className,
}: {
  value: string;
  onChange: (v: string) => void;
  className?: string;
}) {
  const { isListening, toggle, supported } = useSpeechInput(value, onChange);
  if (!supported) return null;

  return (
    <button
      type="button"
      onClick={toggle}
      title={isListening ? "Stop dictating" : "Dictate"}
      className={cn(
        "flex h-5 w-5 items-center justify-center rounded transition-colors",
        isListening
          ? "text-red-500 hover:text-red-400"
          : "text-muted-foreground hover:text-foreground",
        className
      )}
    >
      {isListening ? (
        <MicOff className="h-3.5 w-3.5 animate-pulse" />
      ) : (
        <Mic className="h-3.5 w-3.5" />
      )}
    </button>
  );
}
