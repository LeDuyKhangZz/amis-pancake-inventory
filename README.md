# Đồng bộ tồn kho AMIS CRM → Pancake POS

Chương trình Node.js 20 này đồng bộ **một chiều** danh mục hàng hóa, SKU và tồn kho thực tế từ AMIS CRM sang Pancake POS. AMIS là nguồn dữ liệu gốc. Chương trình chạy dưới dạng các API serverless trên Vercel, không có giao diện và không gọi API sản xuất khi chạy test.

## Phạm vi

Chương trình thực hiện:

- Đọc toàn bộ hàng hóa, kho và `main_stock_quantity` từ AMIS.
- Dùng `product_code` AMIS làm SKU ở cả cấp sản phẩm và variation Pancake.
- Tạo đúng một variation mặc định cho hàng hóa chưa có trong Pancake.
- Đặt tồn ban đầu khi tạo và cập nhật tồn thực tế cho variation đã tồn tại.
- Bỏ qua hàng hóa AMIS có `inactive=true`.
- Chống tạo trùng bằng cách tải lại và đối chiếu SKU Pancake ở đầu mỗi lần chạy.
- Dừng an toàn khi có nhiều kho mà chưa chỉ rõ kho cần dùng.

Chương trình cố ý **không** đồng bộ giá, ảnh, mô tả, khách hàng, đơn hàng; không xóa sản phẩm; không sửa tên sản phẩm Pancake đã tồn tại; không dùng webhook; và không đồng bộ theo chiều Pancake → AMIS.

## Cấu trúc dự án

```text
api/
  _shared.js       Xác thực và lỗi dùng chung cho API
  health.js        GET /api/health
  sync.js          GET preview, POST commit
  cron.js          GET commit dành cho Vercel Cron
lib/
  config.js        Đọc và kiểm tra biến môi trường
  http.js          HTTP timeout, retry GET và lọc bí mật
  misa.js          Client AMIS, phân trang từ 0
  pancake.js       Client Pancake, phân trang từ 1
  sync.js          Lập kế hoạch và thực thi đồng bộ
tests/
  sync.test.js     Test bằng fetch giả lập, không gọi API thật
```

## 1. Chuẩn bị thông tin kết nối

### AMIS CRM

Trong phần quản lý Open API/ứng dụng tích hợp của AMIS CRM, tạo hoặc mở ứng dụng tích hợp để lấy:

- AppID/Client ID. Giá trị đã biết của dự án này là `AbrahamInventory2026`.
- Mã bảo mật/Client Secret. Chỉ nhập giá trị này vào biến môi trường `MISA_CLIENT_SECRET`.

Tài liệu chính thức: [MISA CRM Connect API v2](https://crmconnect.misa.vn/docs-v2/index.html) và [trợ giúp API AMIS CRM](https://helpcrm.misa.vn/kb/api/).

### Pancake POS

Trong phần cấu hình/API của Pancake POS, lấy:

- Shop ID. Giá trị đã biết của dự án này là `1022081353`.
- API Key. Chỉ nhập giá trị này vào biến môi trường `PANCAKE_API_KEY`.

Tài liệu chính thức: [Pancake POS API](https://docs.pancake.biz/pos/api/).

Client Secret AMIS và API Key Pancake là hai loại khóa khác nhau. Không nhập chéo khóa giữa hai hệ thống, không gửi khóa vào chat, issue, ảnh chụp hoặc commit Git.

## 2. Chạy kiểm thử trên máy

Yêu cầu Node.js 20 trở lên. Dự án không có dependency ngoài nên không bắt buộc chạy `npm install`.

Bash:

```bash
npm test
npm run check
```

PowerShell:

```powershell
npm.cmd test
npm.cmd run check
```

Test sử dụng `fetch` giả lập và không kết nối AMIS/Pancake thật.

## 3. Đưa mã nguồn lên GitHub

Tạo một repository riêng tư trên GitHub. Tại thư mục dự án, chạy:

Bash:

```bash
git init
git add .
git commit -m "Add AMIS to Pancake inventory sync"
git branch -M main
git remote add origin https://github.com/TEN-CUA-BAN/TEN-REPOSITORY.git
git push -u origin main
```

PowerShell dùng cùng các lệnh Git:

```powershell
git init
git add .
git commit -m "Add AMIS to Pancake inventory sync"
git branch -M main
git remote add origin https://github.com/TEN-CUA-BAN/TEN-REPOSITORY.git
git push -u origin main
```

Trước khi đẩy, kiểm tra `git status` và bảo đảm `.env`, `.env.local`, `.vercel` không xuất hiện trong danh sách commit.

## 4. Triển khai lên Vercel

1. Đăng nhập Vercel và chọn **Add New → Project**.
2. Import GitHub repository vừa tạo.
3. Giữ cấu hình framework mặc định; Vercel tự nhận các file trong `api/`.
4. Mở **Project → Settings → Environment Variables**.
5. Thêm từng biến ở bảng dưới cho môi trường Production. Có thể thêm cho Preview nếu cần kiểm thử bản deploy preview.

| Biến | Bắt buộc | Giá trị |
|---|---:|---|
| `MISA_CLIENT_ID` | Có | `AbrahamInventory2026` |
| `MISA_CLIENT_SECRET` | Có | Client Secret lấy từ AMIS |
| `MISA_STOCK_CODE` | Khi AMIS có nhiều kho | `stock_code` của kho cần đồng bộ |
| `PANCAKE_SHOP_ID` | Có | `1022081353` |
| `PANCAKE_API_KEY` | Có | API Key lấy từ Pancake |
| `PANCAKE_WAREHOUSE_ID` | Khi Pancake có nhiều kho | ID kho đích |
| `SYNC_SECRET` | Có | Chuỗi ngẫu nhiên dài bảo vệ chạy thủ công |
| `CRON_SECRET` | Có | Chuỗi ngẫu nhiên dài khác bảo vệ Cron |
| `CREATE_BATCH_SIZE` | Không | Mặc định `25`; phải là số nguyên dương |

Không thêm tiền tố `NEXT_PUBLIC_`. Có thể tạo chuỗi bí mật trên máy, ví dụ:

Bash:

```bash
openssl rand -hex 32
```

PowerShell:

```powershell
[Convert]::ToHexString([Security.Cryptography.RandomNumberGenerator]::GetBytes(32)).ToLower()
```

Sau khi thêm hoặc đổi biến môi trường, vào **Deployments**, chọn deployment mới nhất và **Redeploy** để runtime nhận cấu hình mới.

## 5. Kiểm tra health

Mở URL sau trong trình duyệt:

```text
https://TEN-DU-AN.vercel.app/api/health
```

Kết quả chỉ cho biết biến nào đã được cấu hình, không trả giá trị khóa:

```json
{
  "ok": true,
  "service": "amis-pancake-inventory-sync",
  "configured": {
    "misa": true,
    "pancake": true,
    "manual_sync": true,
    "cron": true
  }
}
```

Nếu một mục là `false`, bổ sung biến tương ứng rồi redeploy.

## 6. Luôn chạy preview trước

Preview được phép đọc AMIS và Pancake nhưng không tạo sản phẩm hay cập nhật tồn kho. POST đăng nhập AMIS vẫn diễn ra vì AMIS yêu cầu token; không có POST ghi dữ liệu sang Pancake.

Bash:

```bash
curl -H "Authorization: Bearer SYNC_SECRET" \
  "https://TEN-DU-AN.vercel.app/api/sync"
```

PowerShell:

```powershell
$headers = @{
  Authorization = "Bearer SYNC_SECRET"
}

Invoke-RestMethod `
  -Method GET `
  -Uri "https://TEN-DU-AN.vercel.app/api/sync" `
  -Headers $headers
```

Thay chữ `SYNC_SECRET` trong lệnh bằng giá trị thật ngay trên máy của bạn; không lưu lệnh có khóa vào repository. Đọc kỹ:

- `plan.create_products`: số sản phẩm mới dự kiến tạo.
- `plan.update_inventory`: số SKU hiện có dự kiến cập nhật tồn.
- `plan.skipped`: số dòng bị bỏ qua.
- `preview.*_sample`: tối đa 20 dòng mẫu để đối chiếu SKU, tồn và lý do bỏ qua.

Nếu có nhiều kho, API sẽ trả lỗi an toàn thay vì tự đoán. Điền `MISA_STOCK_CODE` hoặc `PANCAKE_WAREHOUSE_ID`, redeploy và preview lại.

## 7. Chạy commit thủ công

Chỉ chạy khi kết quả preview đúng. Mỗi lần commit chỉ tạo tối đa `CREATE_BATCH_SIZE` sản phẩm mới, nhưng vẫn cập nhật tồn của toàn bộ SKU đã tồn tại theo batch tối đa 50 variation.

Bash:

```bash
curl -X POST \
  -H "Authorization: Bearer SYNC_SECRET" \
  "https://TEN-DU-AN.vercel.app/api/sync"
```

PowerShell:

```powershell
$headers = @{
  Authorization = "Bearer SYNC_SECRET"
}

Invoke-RestMethod `
  -Method POST `
  -Uri "https://TEN-DU-AN.vercel.app/api/sync" `
  -Headers $headers
```

Nếu response có:

```json
{
  "remaining_to_create": 75,
  "run_again_required": true
}
```

hãy gọi lại POST. Lặp cho đến khi `remaining_to_create` bằng `0` và `run_again_required` là `false`. Mỗi lần chạy đều tải lại SKU Pancake trước khi tạo nên một lần chạy lại bình thường không tạo trùng. Nếu request tạo sản phẩm bị timeout hoặc trạng thái không rõ, không bấm liên tục trong cùng request; lần chạy tiếp theo sẽ đối chiếu lại danh sách SKU.

Cuối cùng, mở Pancake và kiểm tra tên sản phẩm, SKU cấp sản phẩm, SKU variation và tồn kho của một số mã mẫu.

## 8. Cron

`vercel.json` đang cấu hình:

```text
0 1 * * *
```

Lịch chạy một lần mỗi ngày lúc **01:00 UTC** (08:00 theo giờ Việt Nam khi UTC+7). Vercel gửi `Authorization: Bearer CRON_SECRET` tới `/api/cron`; `CRON_SECRET` phải được cấu hình trong Project Environment Variables.

Nếu gói Vercel của bạn hỗ trợ tần suất cao hơn, có thể đổi lịch thành mỗi 10 phút:

```text
*/10 * * * *
```

Không giả định Vercel Hobby hỗ trợ lịch mỗi 10 phút. Nếu gói hiện tại không hỗ trợ tần suất đó, hãy giữ lịch hằng ngày, nâng gói hoặc dùng scheduler khác có thể gửi header `Authorization: Bearer CRON_SECRET`.

## Quy tắc dữ liệu và lỗi

- SKU được trim và so sánh không phân biệt hoa/thường, nhưng giá trị gốc được giữ nguyên khi gửi sang Pancake.
- Thiếu `product_code`, thiếu `product_name`, trùng mã AMIS, trùng SKU Pancake hoặc tồn số lẻ đều bị bỏ qua và có lý do.
- Không có dòng ledger thì tồn mặc định là `0`; tồn âm được chuyển thành `0`.
- Một lỗi tạo sản phẩm không làm dừng các sản phẩm còn lại trong batch.
- GET được retry giới hạn với exponential backoff khi gặp `429`, `502`, `503`, `504` hoặc lỗi mạng. POST ghi dữ liệu không được retry mù quáng.
- Log chỉ chứa tên thao tác logic, HTTP status và số lượng tổng hợp; không chứa URL Pancake đầy đủ, body đăng nhập hoặc khóa.

## Khi khóa bị lộ

1. Thu hồi/đổi Client Secret trong AMIS hoặc API Key trong Pancake ngay tại hệ thống tương ứng.
2. Tạo lại `SYNC_SECRET` và `CRON_SECRET` nếu các chuỗi này bị lộ.
3. Cập nhật từng giá trị trong **Vercel Project → Settings → Environment Variables**.
4. Redeploy dự án.
5. Nếu khóa từng được commit, xóa khóa khỏi lịch sử Git bằng công cụ phù hợp và coi khóa cũ là không còn an toàn dù commit đã bị xóa.
6. Chạy health, preview, rồi mới commit lại.

Không đăng khóa mới vào ticket, chat hoặc log khi xử lý sự cố.
