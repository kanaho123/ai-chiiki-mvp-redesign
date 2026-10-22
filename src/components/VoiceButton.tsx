import { useEffect, useRef, useState } from "react";
import { Icon } from "./Icon";

// 音声入力（ブラウザの音声認識・日本語）。聞き取った文字を onText に渡すだけで、入力欄の中身は利用者が確かめて直せる。
// 使えない端末（音声認識のないブラウザ）ではボタンを出さない。音声はこのアプリのサーバーには送らない
// （ブラウザによっては、ブラウザ自身の音声認識のサービスに送られる）。

type RecognitionResult = { isFinal: boolean; 0: { transcript: string } };
type Recognition = {
  lang: string; interimResults: boolean; continuous: boolean; maxAlternatives: number;
  start(): void; stop(): void; abort(): void;
  onresult: ((e: { resultIndex: number; results: ArrayLike<RecognitionResult> }) => void) | null;
  onerror: ((e: { error: string }) => void) | null;
  onend: (() => void) | null;
};
type RecognitionCtor = new () => Recognition;

const recognitionCtor = (): RecognitionCtor | undefined => {
  if (typeof window === "undefined") return undefined;
  const w = window as unknown as { SpeechRecognition?: RecognitionCtor; webkitSpeechRecognition?: RecognitionCtor };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition;
};

const ERROR_TEXT: Record<string, string> = {
  "not-allowed": "マイクが使えません。端末の設定で、このページのマイクを許可してください",
  "service-not-allowed": "マイクが使えません。端末の設定で、このページのマイクを許可してください",
  "no-speech": "声が聞き取れませんでした。もう一度押して話してください",
  "audio-capture": "マイクが見つかりませんでした",
};

/** 音声認識の開始・停止と状態。onText は聞き取れた文（確定したもの）ごとに呼ぶ */
export function useSpeech(onText: (text: string) => void) {
  const Ctor = recognitionCtor();
  const [listening, setListening] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const rec = useRef<Recognition | null>(null);
  const onTextRef = useRef(onText);
  onTextRef.current = onText;
  useEffect(() => () => rec.current?.abort(), []);

  const start = () => {
    if (!Ctor || listening) return;
    setError(null);
    const r = new Ctor();
    r.lang = "ja-JP";
    r.interimResults = false;
    r.continuous = false;
    r.maxAlternatives = 1;
    r.onresult = (e) => {
      let text = "";
      for (let i = e.resultIndex; i < e.results.length; i++) if (e.results[i].isFinal) text += e.results[i][0].transcript;
      if (text.trim()) onTextRef.current(text.trim());
    };
    r.onerror = (e) => { if (e.error !== "aborted") setError(ERROR_TEXT[e.error] ?? "音声入力を使えませんでした。文字で入力してください"); };
    r.onend = () => { setListening(false); rec.current = null; };
    rec.current = r;
    try {
      r.start();
      setListening(true);
    } catch {
      setError("音声入力を使えませんでした。文字で入力してください");
    }
  };
  const stop = () => rec.current?.stop();
  return { supported: !!Ctor, listening, error, start, stop };
}

/** 「話して入力」ボタン（押すと聞き取り、もう一度押すと止める）。使えない端末では何も出さない */
export function VoiceButton({ onText, label = "話して入力", className = "btn-secondary" }: { onText: (text: string) => void; label?: string; className?: string }) {
  const s = useSpeech(onText);
  if (!s.supported) return null;
  return (
    <div className="voice">
      <button type="button" className={`${className} voice-btn ${s.listening ? "listening" : ""}`} aria-pressed={s.listening} onClick={s.listening ? s.stop : s.start}>
        <Icon name="mic" size={22} />{s.listening ? "聞いています…（押すと止まる）" : label}
      </button>
      {s.error && <p className="field-error" role="alert"><Icon name="alert" size={18} />{s.error}</p>}
    </div>
  );
}
