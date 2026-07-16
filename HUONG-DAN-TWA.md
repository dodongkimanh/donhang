# APK TWA — Quản Lý Đơn Hàng

Đã build và ký xong. File nằm trong thư mục `android-twa/` (không commit vào git vì chứa khóa ký riêng tư).

## File cần dùng

- **`android-twa/app-release-signed.apk`** — file cài đặt, copy sang điện thoại và cài trực tiếp.
- `android-twa/app-release-bundle.aab` — bản Android App Bundle, chỉ cần nếu sau này muốn đăng lên Google Play (không dùng để cài trực tiếp).

## Thông tin app

- Package ID: `com.kimanh.donhang`
- Domain xác minh: `https://donhang-one.vercel.app`
- Digital Asset Links đã deploy tại `https://donhang-one.vercel.app/.well-known/assetlinks.json` → app mở full màn hình, không có thanh địa chỉ Chrome.

## Cài lên điện thoại

1. Copy `android-twa/app-release-signed.apk` sang điện thoại (USB, Zalo, Google Drive, Bluetooth...)
2. Trên điện thoại: Cài đặt → Bảo mật → bật **"Cài ứng dụng từ nguồn không xác định"** cho ứng dụng dùng để mở file (Files, Zalo...)
3. Mở file `.apk` → Cài đặt
4. Lặp lại đúng như vậy trên điện thoại thứ hai — dùng chung file APK này, không cần build lại.

## ⚠️ Giữ cẩn thận: khóa ký (signing key)

File `android-twa/android.keystore` + `android-twa/keystore-credentials.txt` là **khóa ký riêng** của app này.

- **Không mất, không xoá.** Nếu sau này muốn cập nhật app (build lại APK mới), bắt buộc phải ký bằng đúng khóa này — mất khóa nghĩa là không thể phát hành bản cập nhật cho các máy đã cài bản cũ, phải gỡ cài đặt và cài lại từ đầu như một app hoàn toàn mới.
- Không chia sẻ file `keystore-credentials.txt` (chứa mật khẩu) hay `android.keystore` công khai.
- Hai file này **không được đưa vào git** (đã thêm `android-twa/` vào `.gitignore`) — nên tự sao lưu riêng (USB, Drive cá nhân...).

## Muốn build lại / cập nhật app sau này

Nhắn Claude: "build lại APK cho phiên bản mới" — sẽ dùng lại đúng `android-twa/android.keystore` để giữ nguyên định danh app, chỉ tăng version.
