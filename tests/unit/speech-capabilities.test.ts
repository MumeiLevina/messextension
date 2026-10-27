import { expect, it, vi } from 'vitest';
import { probeSpeechSupport } from '../../extension/src/speech/speech-capabilities';

it('detects speech without starting a microphone, contacting a backend or claiming verified Vietnamese', async () => {
  const ctor = vi.fn();
  vi.stubGlobal('SpeechRecognition', ctor);
  const fetchSpy = vi.spyOn(globalThis, 'fetch');
  const caps = await probeSpeechSupport();
  expect(caps.supported).toBe(true);
  expect(caps.offline).toBe(false);
  expect(caps.detail).toContain('chưa được xác nhận');
  expect(ctor).not.toHaveBeenCalled();
  expect(fetchSpy).not.toHaveBeenCalled();
  fetchSpy.mockRestore();
  vi.unstubAllGlobals();
});
