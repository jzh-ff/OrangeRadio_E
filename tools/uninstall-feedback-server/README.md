# OrangeSea 卸载反馈接收器（自建后端）

零依赖单文件 Node 服务，接收卸载器提交的卸载反馈：

- `POST /feedback`：接收 JSON（`feedback` / `contact` / `version` / `app` / `os` / `time`），追加 JSONL 日志；配置 SMTP 后同时转发到 QQ 邮箱。
- `GET /feedback`：返回暗色网页反馈表单（即卸载器发送失败时的浏览器兜底页）。
- 自带限流（单 IP 10 次/分钟、全局 500 次/天）、8KB 请求体上限、字段长度清洗。
- **SMTP 授权码只放在服务器环境变量里，绝不会进安装包**（安装包可被任何人解包，嵌入授权码=邮箱被盗用）。

## 部署（轻量云服务器）

**最快方式（SSH 不通也能装）**：用 `install-remote.sh`——接收器代码已 base64 内嵌，在腾讯云控制台 **WebShell** 里粘贴整个文件内容回车即可完成安装（建目录、写代码、systemd 常驻、自测、打印对外地址）。也可 `SMTP_PASS=16位授权码 bash install-remote.sh` 一步到位带上邮件转发。

手工方式如下：

1. 上传本目录到服务器，例如 `/opt/orangesea-feedback/`。

2. 开通 QQ 邮箱 SMTP 并获取授权码（一次性）：
   - QQ 邮箱网页版 → 设置 → 账号 → 开启「SMTP/IMAP/POP3 服务」；
   - 按提示发短信，生成 **16 位授权码**（不是 QQ 密码）。

3. 启动（先手动验证）：

   ```bash
   PORT=8787 \
   SMTP_HOST=smtp.qq.com SMTP_PORT=465 \
   SMTP_USER=1226163446@qq.com \
   SMTP_PASS=你的16位授权码 \
   MAIL_TO=1226163446@qq.com \
   node feedback-server.js
   ```

   看到 `[feedback-server] listening on :8787` 即成功。

4. 快速自测（应返回 `{"success":true,"mailed":true}` 且 QQ 邮箱收到测试邮件）：

   ```bash
   curl -X POST http://127.0.0.1:8787/feedback \
     -H 'Content-Type: application/json' \
     -d '{"feedback":"部署自测：中文内容","contact":"QQ 123","version":"0.1.0"}'
   ```

   浏览器打开 `http://127.0.0.1:8787/feedback` 应看到网页表单。

5. 常驻运行（systemd 示例）：

   ```ini
   # /etc/systemd/system/orangesea-feedback.service
   [Unit]
   Description=OrangeSea uninstall feedback receiver
   After=network.target

   [Service]
   WorkingDirectory=/opt/orangesea-feedback
   Environment=PORT=8787
   Environment=SMTP_HOST=smtp.qq.com
   Environment=SMTP_USER=1226163446@qq.com
   Environment=SMTP_PASS=你的16位授权码
   Environment=MAIL_TO=1226163446@qq.com
   Environment=FEEDBACK_LOG=/opt/orangesea-feedback/uninstall-feedback.jsonl
   ExecStart=/usr/bin/node feedback-server.js
   Restart=always

   [Install]
   WantedBy=multi-user.target
   ```

   ```bash
   systemctl daemon-reload && systemctl enable --now orangesea-feedback
   ```

6. 对外暴露：建议 nginx 反代 + HTTPS（Let's Encrypt 免费证书），并把 `X-Forwarded-For` 传给后端以记录真实 IP。**卸载器端点需要 https**，否则部分网络环境会拦截明文 POST。

   ```nginx
   location /feedback {
       proxy_pass http://127.0.0.1:8787;
       proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
   }
   ```

7. 可选加固：设置 `FEEDBACK_TOKEN=随机串`，路径即变为 `/feedback-随机串`，充当轻量门禁（卸载器端点同步更新）。

## 接回卸载器

部署好后把对外地址（形如 `https://你的域名/feedback`）填入 `build/installer.nsh`：

```nsh
!define MINERADIO_FEEDBACK_ENDPOINT "https://你的域名/feedback"
```

然后重新 `npm run build:win` 打包。卸载器会 POST 同样的 JSON 到该地址；发送失败时打开该地址的网页表单兜底。

## 日志与排障

- 所有反馈（无论邮件是否成功）都会追加到 `uninstall-feedback.jsonl`，一行一条 JSON。
- 邮件失败不影响接口返回 200（`mailed:false`），先查日志再查 SMTP 授权码。
- 常见错误：`SMTP 535` = 授权码错误；`SMTP timeout` = 服务器出网 465 端口被拦（云厂商安全组放行）。
