/**
 * Screenshot capture for the OCR fallback.
 *
 * Capture is explicit and consented: the user must request it. The service
 * worker performs the actual `captureVisibleTab` call and refuses to capture
 * anything that is not the Messenger tab.
 */

export interface CaptureResult {
  dataUrl: string | null;
  error: string | null;
}

export interface ConsentState {
  granted: boolean;
  grantedAt: number | null;
}

/** Tracks explicit user consent for screenshot capture. */
export class CaptureConsent {
  private state: ConsentState = { granted: false, grantedAt: null };

  grant(): void {
    this.state = { granted: true, grantedAt: Date.now() };
  }

  revoke(): void {
    this.state = { granted: false, grantedAt: null };
  }

  get isGranted(): boolean {
    return this.state.granted;
  }

  get snapshot(): ConsentState {
    return { ...this.state };
  }
}

/**
 * Requests a screenshot of the Messenger tab from the service worker.
 * Returns a structured error rather than throwing.
 */
export async function captureMessengerScreenshot(): Promise<CaptureResult> {
  try {
    const response = (await chrome.runtime.sendMessage({ type: 'echo:capture' })) as {
      dataUrl?: string | null;
    };
    if (!response?.dataUrl) {
      return {
        dataUrl: null,
        error:
          'Không chụp được ảnh. Hãy mở tab Messenger ở chế độ hoạt động và thử lại.',
      };
    }
    return { dataUrl: response.dataUrl, error: null };
  } catch (error) {
    return {
      dataUrl: null,
      error: error instanceof Error ? error.message : 'Không chụp được ảnh.',
    };
  }
}
