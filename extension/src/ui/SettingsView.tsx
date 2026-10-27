
import type { ScanIntervalMs } from '../core/models';
import { SCAN_INTERVAL_OPTIONS } from '../core/models';
import { PERMISSIONS, PRIVACY_POINTS } from '../security/permissions';

interface Props {
  current: ScanIntervalMs;
  onInterval: (ms: ScanIntervalMs) => void;
}

export function SettingsView({ current, onInterval }: Props) {
  return (
    <>
      <section className="card">
        <h2>Cài đặt</h2>
        <div className="row">
          <span className="label">Chu kỳ quét</span>
          <span className="value">
            <select
              value={current}
              onChange={(e) => void onInterval(Number(e.target.value) as ScanIntervalMs)}
            >
              {SCAN_INTERVAL_OPTIONS.map((ms) => (
                <option key={ms} value={ms}>
                  {ms / 1000} giây
                </option>
              ))}
            </select>
          </span>
        </div>
        <p className="label" style={{ marginTop: 8 }}>
          Chu kỳ 5 giây là mặc định. Việc quét tạm dừng khi bạn chuyển sang tab khác.
        </p>
      </section>

      <section className="card">
        <h2>Quyền của tiện ích</h2>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
          <tbody>
            {PERMISSIONS.map((p) => (
              <tr key={p.name}>
                <td className="mono" style={{ padding: '4px 6px 4px 0', verticalAlign: 'top' }}>
                  {p.name}
                </td>
                <td style={{ padding: '4px 0' }}>{p.purpose}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <section className="card">
        <h2>Quyền riêng tư</h2>
        <ul className="plain">
          {PRIVACY_POINTS.map((point) => (
            <li key={point}>{point}</li>
          ))}
        </ul>
      </section>
    </>
  );
}
