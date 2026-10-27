/**
 * Central description of the extension's permissions and data handling.
 *
 * The UI reads these strings so the privacy panel and the code cannot drift.
 */

export interface PermissionEntry {
  name: string;
  purpose: string;
  required: boolean;
}

export const PERMISSIONS: PermissionEntry[] = [
  {
    name: 'sidePanel',
    purpose: 'Hiển thị bảng điều khiển Echo Assistant cạnh trình duyệt.',
    required: true,
  },
  {
    name: 'storage',
    purpose: 'Lưu cài đặt của bạn (khoảng thời gian quét, ngôn ngữ). Không lưu nội dung tin nhắn.',
    required: true,
  },
  {
    name: 'activeTab',
    purpose: 'Chụp màn hình tab Messenger khi bạn bấm nút OCR và đồng ý.',
    required: false,
  },
  {
    name: 'clipboardWrite',
    purpose: 'Sao chép bản nháp trả lời vào bộ nhớ tạm để bạn dán vào Messenger.',
    required: true,
  },
  {
    name: 'https://www.facebook.com/*',
    purpose: 'Chỉ chạy trên Facebook để đọc cuộc trò chuyện bạn đang chọn.',
    required: true,
  },
];

export const PRIVACY_POINTS = [
  'Không bao giờ thu thập mật khẩu, cookie hay token phiên đăng nhập.',
  'Chỉ đọc cuộc trò chuyện đang được chọn trong Messenger — không quét danh sách trò chuyện.',
  'Nội dung tin nhắn chỉ nằm trong bộ nhớ của trình duyệt và bị xóa khi bạn dừng theo dõi.',
  'Ảnh chụp màn hình chỉ được tạo khi bạn bấm nút và đồng ý; ảnh không được tải lên máy chủ khác.',
  'Không có tính năng gửi tin nhắn tự động — bạn luôn bấm nút Gửi bằng tay.',
  'Đọc DOM và OCR diễn ra cục bộ. Nhận dạng giọng nói của Chrome có thể gửi âm thanh đến Google.',
];
