# Activity Journal

[![CI](https://github.com/vietvh-3042/activity-journal/actions/workflows/ci.yml/badge.svg?branch=develop)](https://github.com/vietvh-3042/activity-journal/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)

Ứng dụng local-only cho Windows 10 22H2/Windows 11 x64, ghi timeline ứng dụng đang dùng để có thể tìm lại hoạt động. Dự án không ghi phím, clipboard, ảnh màn hình, nội dung trang hoặc URL đầy đủ.

> **Trạng thái:** MVP thử nghiệm `0.4.2`. Chưa được security audit độc lập và binary hiện chưa được code-sign.

## Trạng thái MVP

- Electron + React dashboard, system tray, auto-start và IPC whitelist.
- .NET 10 collector dùng WinEvent, LastInputInfo, Session/Power events và Recent Items.
- SQLite/SQLCipher với khóa 256-bit được Windows DPAPI `CurrentUser` bảo vệ.
- Chrome/Edge Manifest V3 extension chỉ gửi title + hostname của tab active.
- Privacy rules được áp dụng trước persistence; browser không có extension chỉ được ghi dưới tên chung.
- Timeline ngày, full-text search, thống kê tuần, retention và xóa dữ liệu.

## Yêu cầu phát triển

- Windows 10 Pro 22H2 x64 (build 19045) hoặc Windows 11 x64.
- Node.js 22.12+ và npm (Electron 43 yêu cầu Node 22 cho toolchain).
- .NET 10 SDK để build/test; người dùng cuối không cần cài .NET vì helper được publish self-contained.

WinEvent, DPAPI, native messaging và installer phải được build/test từ Windows, không phải bên trong WSL/Linux.

## Chạy development

```powershell
npm install
npm run build:helper
npm run dev
```

Nếu chỉ phát triển giao diện trên Linux/WSL, `npm run dev` vẫn mở dashboard nhưng collector sẽ báo offline.

## Cài extension Chrome/Edge

1. Chạy Activity Journal ít nhất một lần để app đăng ký native host trong `HKCU`.
2. Trong dashboard vào **Cài đặt → Mở thư mục extension**.
3. Mở `chrome://extensions` hoặc `edge://extensions`, bật **Developer mode**.
4. Chọn **Load unpacked** và trỏ tới thư mục vừa mở.
5. Không bật extension trong Incognito/InPrivate. Manifest cũng đặt `incognito: not_allowed`.

Extension có ID cố định `bkbaolcobjbcpjkbneipppmgmneemegf`; native host chỉ chấp nhận origin này.

Chrome có thể mô tả quyền `tabs` bằng câu **Read your browsing history**. Extension không đọc danh sách lịch sử:
service worker chỉ quan sát tab active trong cửa sổ đang focus, loại bỏ URL path/query/fragment và gửi title + hostname
tới native host local. Extension không có content script hoặc host permission.

## Chạy bản pilot đã đóng gói

1. Chép bản ZIP mới nhất trong `release/` sang Windows và giải nén toàn bộ.
2. Chạy `win-unpacked\Activity Journal.exe`. Đây là binary unsigned nên Windows có thể hiển thị SmartScreen; chỉ tiếp tục nếu checksum khớp file `release/SHA256SUMS.txt`.
3. Mở dashboard, xác nhận trạng thái **Đang ghi** và **Cơ sở dữ liệu đã mã hóa**.
4. Cài extension theo hướng dẫn trên, sau đó dùng thử ít nhất một ngày trước khi bật auto-start lâu dài.

Bản ZIP chạy trực tiếp không có uninstaller; xóa thư mục `win-unpacked` để gỡ chương trình. Dữ liệu vẫn được giữ tại `%LOCALAPPDATA%\Activity Journal` cho tới khi xóa trong dashboard.

## Test và đóng gói

```powershell
npm run check
npm run test:helper
npm run build
npm run dist:win
```

Installer NSIS là per-user và unsigned. Dữ liệu nằm tại `%LOCALAPPDATA%\Activity Journal` và được giữ lại khi uninstall; uninstaller chỉ xóa registry/native-host bridge. Xóa lịch sử bằng dashboard trước khi uninstall nếu muốn xóa DB.

Maintainer có thể tạo GitHub prerelease đã kèm portable ZIP, installer và SHA-256 bằng cách push tag:

```powershell
git tag v0.4.2
git push origin v0.4.2
```

Release workflow chạy lại quality gate và test helper trên Windows trước khi publish. Không tạo tag nếu commit chưa được
kiểm thử trực tiếp trên máy Windows mục tiêu.

## Kiểm thử Windows bắt buộc trước khi dùng hằng ngày

- Chuyển cửa sổ, đổi title, mở/đóng ứng dụng và mở tệp xuất hiện đúng trên timeline.
- Idle 5 phút, lock/unlock, sleep/resume tạo đúng các segment riêng.
- Chrome/Edge thường chỉ lưu title + hostname; Incognito/InPrivate và khi extension mất kết nối không làm lộ title/URL.
- Exclusion theo app/domain/title/path tạo segment `excluded` không chứa metadata.
- Kill Electron/helper rồi mở lại không làm mất các segment đã commit.
- Chạy soak test 24 giờ và đo CPU/RAM trên máy Windows đích.

## Ranh giới bảo mật

SQLCipher bảo vệ DB khi không có khóa; DPAPI ngăn Windows user khác giải mã khóa. Giống mọi ứng dụng dùng DPAPI CurrentUser, tiến trình độc hại đang chạy dưới cùng tài khoản Windows vẫn có thể yêu cầu DPAPI giải mã. App không có network client, cloud sync, telemetry hay auto-updater trong MVP.

## Giới hạn hiện tại

- Chỉ hỗ trợ Windows 10 22H2/Windows 11 x64.
- Extension phải được sideload thủ công và không hoạt động trong Incognito/InPrivate.
- App không lưu URL đầy đủ nên không bảo đảm mở lại chính xác trang cũ.
- Theo dõi file từ Recent Items là best-effort và có thể bỏ qua kết quả không chắc chắn.
- Binary unsigned có thể bị SmartScreen cảnh báo; chưa có auto-update hoặc quy trình release tái lập hoàn toàn.

## Đóng góp và bảo mật

Đọc [CONTRIBUTING.md](CONTRIBUTING.md) trước khi gửi pull request. Không đăng database, activity log, title,
domain, path hoặc token thật lên issue công khai. Báo cáo lỗ hổng theo [SECURITY.md](SECURITY.md) và dùng GitHub
private vulnerability reporting.

Checklist dành cho maintainer nằm tại [docs/PUBLIC_RELEASE_CHECKLIST.md](docs/PUBLIC_RELEASE_CHECKLIST.md).

## License

Activity Journal được phát hành theo [MIT License](LICENSE).
