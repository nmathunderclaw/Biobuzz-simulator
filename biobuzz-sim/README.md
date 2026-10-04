# BIOBUZZ Sim 3D (FTC 2026–2027)

Mô phỏng 3D trận FTC BIOBUZZ: sân dựng từ file CAD chính thức của FIRST, vật lý bóng/HIVE 300 Hz, robot tự thiết kế, tự lập trình chiến thuật AUTO, AprilTag auto-aim, bot AI, trọng tài tự động, replay + phân tích trận, đồ họa bloom, chơi online hai máy.

## Chạy ngay
Mở `biobuzz-sim.html` bằng Chrome/Edge (cần mạng để tải three.js r128 từ cdnjs và font Google). Chơi online chỉ chạy khi trang mở trong Claude (tính năng phòng `room` của artifact).

## Điều khiển
- Mặc định robot lái bằng **tay cầm** (Xbox, PlayStation, Logitech F310 chế độ X). Bàn phím vẫn dùng cho phím tắt (C đổi góc nhìn, Esc tạm dừng, Delete xếp lại sân khi luyện tập…).
- Muốn lái bằng bàn phím: Cài đặt → Điều khiển → “Lái robot bằng bàn phím”. Phím được tăng dần như cần analog, xoay ở 60% công suất (chỉnh được). Tắt bộ gõ tiếng Việt (Unikey/EVKey) khi lái bằng phím, nếu không W A S D bị nuốt; trang tự nhắc khi phát hiện.
- Góc camera: kéo chuột trái để xoay, Shift + kéo hoặc chuột phải để dời, lăn để thu phóng, nhấp đúp để đặt lại; mỗi góc nhìn nhớ riêng. Tay cầm: tạm dừng → “Chỉnh góc camera này”.

## Chiến thuật AUTO
Menu **Chiến thuật AUTO**: vẽ chương trình 30 giây trên sân nhìn từ khu lái ĐỎ (bên XANH tự xoay 180°). Các bước: Đi tới, Bắn (tại chỗ / tự tìm chỗ), Nhặt bóng trong vòng tròn, Xoay, Chờ, Chờ tới giây, PARK. “Chạy thử” chạy chương trình bằng chính engine (một robot trên sân) và ghi kết quả từng bước; “Bản đồ bắn” tô chỗ bắn đứng yên vào được. Chọn chương trình cho mình và cho bot đồng đội ở màn hình Đấu trận / Hai người / Chơi online; chia sẻ bằng mã `BBA1.…`. Mô hình và bộ chạy chương trình nằm trong `ai.js` (`AI.PLAN`, `runPlan`), giao diện trong `autoed.js`.

## Build lại từ mã nguồn
```
node build.mjs        # ghép src/ thành dist/biobuzz-sim.html
```
Thứ tự ghép: engine → ai → render → fx → input → audio → replay → hud → ui → autoed → net → app. `src/fieldcad.b64` (mô hình sân) được nhúng vào trang dưới dạng khối văn bản `#field-cad`; render.js giải nén nó lúc khởi động (DecompressionStream). Nếu trình duyệt không giải được, trang tự dùng sân dựng tay.

## Sân từ file CAD chính thức
`tools/fieldcad/field-cad-step.zip` là file **Field CAD (STEP, .ZIP) v26-27.2** (15/9/2026) tải từ trang Playing Field Resources của FIRST: https://ftc-resources.firstinspires.org/ftc/field

Tạo lại `src/fieldcad.b64` (cần Python 3 + `pip install cadquery-ocp pymeshlab fast-simplification numpy scipy`; pymeshlab cần thư viện hệ thống `libopengl0`):
```
cd tools/fieldcad
unzip field-cad-step.zip                 # ra field-cad-step.step (35 MB, AP242)
python3 extract.py field-cad-step.step   # đọc STEP bằng OpenCASCADE, chia lưới từng chi tiết -> proto.pkl
python3 build_asset.py                   # bỏ ốc vít, giảm lưới chi tiết đúc, tách 2 HIVE về khung nằm ngang, nén -> src/fieldcad.b64
```
(đường dẫn trong hai script đang trỏ tới `/home/claude/...`; sửa lại cho máy của bạn.)

Hệ tọa độ: CAD là inch, trục Y hướng lên, +X về phía XANH, +Z về phía khán giả, trùng với khung three.js của render.js (`three.x = sim.x`, `three.y = sim.z`, `three.z = -sim.y`). Các số đo va chạm trong engine.js (tường, CELL, FLOWER, khung, băng dính, AprilTag) được đối chiếu với CAD và ghi chú ngay tại chỗ khai báo.

## Các file trong src/
| File | Nội dung |
|---|---|
| engine.js | Vật lý (bước 1/300 s), bóng Magnus, HIVE bập bênh, FLOWER (vòng giữa giữ NECTAR), robot từ spec, mô-tơ/pin/flywheel, AprilTag + odometry, trọng tài, tính điểm |
| ai.js | Bot: A* tìm đường, vai trò (TIP, FLOWER, phòng thủ), PARK, tránh G402/G421; chương trình AUTO của đội (`AI.PLAN`: chuẩn hóa, mã chia sẻ, kiểm tra G304/G402, chạy từng bước) |
| render.js | three.js: sân CAD (hoặc sân dựng tay dự phòng), robot dựng từ spec, nội suy giữa hai bước vật lý, camera chỉnh được theo từng góc nhìn, tự giảm độ phân giải, hậu kỳ "Đẹp nhất" (MSAA + bloom) |
| fieldcad.b64 | Mô hình sân CAD đã nén (166 nghìn tam giác, 36 đường ghép thảm) |
| fx.js | Tia lửa khi vào CELL, bùng nổ khi TIP, vệt bóng bay, pháo giấy, flash khán đài |
| input.js | Tay cầm, bàn phím 2 nửa (tắt lái mặc định, tăng dần, nhận biết bộ gõ tiếng Việt), gán phím |
| audio.js | Âm thanh sân, tiếng robot |
| replay.js | Ghi trận 30 khung/s, trình xem replay, biểu đồ diễn biến, bản đồ sân |
| hud.js | Bảng điểm, bảng robot, camera tag, bảng kết quả |
| ui.js | Menu, xưởng robot, cài đặt |
| autoed.js | Trình soạn chiến thuật AUTO: bản đồ sân, danh sách bước, chạy thử, bản đồ bắn, mã chia sẻ |
| net.js | Chơi online qua phòng của artifact (host chạy vật lý, khách gửi tay lái) |
| app.js | Vòng lặp chính, điều khiển người chơi, thiết lập trận |
| markup.html, style.css | Giao diện |

## Kiểm thử (tùy chọn)
`test/*.mjs` chạy bằng Node (`node test/batch.mjs 6`, `node test/plan.mjs`, `node test/flower2.mjs`, `node test/tip.mjs`), `test/*.py` cần Playwright + Chromium (`python3 test/auto.py` kiểm tra trình soạn AUTO, camera và điều khiển; `python3 test/cad.py high` chụp sân CAD từ nhiều góc).
