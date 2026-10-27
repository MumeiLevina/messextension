/** Read-only capability detection. Microphone access happens only after Record. */
export interface SpeechCapabilities {
  supported: boolean;
  /** vi-VN can be requested; actual service availability is checked on Record. */
  vietnamese: boolean;
  offline: boolean;
  detail: string;
  localBackend: boolean;
}

export async function probeSpeechSupport(): Promise<SpeechCapabilities> {
  const w = window as unknown as { SpeechRecognition?: unknown; webkitSpeechRecognition?: unknown };
  const supported = typeof (w.SpeechRecognition ?? w.webkitSpeechRecognition) === 'function';
  return {
    supported, vietnamese: supported, offline: false, localBackend: false,
    detail: supported
      ? 'Chrome có Web Speech API. Chỉ bấm Ghi âm mới yêu cầu microphone và thử vi-VN. Dịch vụ có thể gửi âm thanh đến Google; khả năng nhận dạng tiếng Việt chưa được xác nhận.'
      : 'Trình duyệt không hỗ trợ Web Speech API. Hãy dùng nhập tay.',
  };
}
