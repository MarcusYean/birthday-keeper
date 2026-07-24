# 🎂 生日管家 (Birthday Keeper) v2

在 NAS（Docker）上自托管的亲友生日提醒工具。支持**农历 / 公历**双历法，可在生日前指定天数，通过**微信推送（Server酱 / PushPlus / Bark）**与**飞书机器人**主动通知你。数据全部存在你自己的 NAS 上，不依赖任何第三方生日 App。

## ✨ 功能

- 📅 记录亲友生日，区分**公历 / 农历**（农历自动换算成当年公历日期，支持闰月）
- 🔔 可在生日前 **N 天**（如 1/3/7 天）多次提醒，每人可单独设置天数与渠道
- 📨 多渠道通知：**微信推送**（Server酱 / PushPlus / Bark）+ **飞书机器人** + 邮件（可选）
- 👥 **多用户系统**：管理员 + 普通用户两种角色，首次访问引导创建管理员
- ⚙️ **全参数前台可调**：管理员在网页「设置」页即可修改所有参数，**每个参数均附作用说明**，保存后立即生效、无需重启容器
- 🖥️ 现代化简约网页界面：侧边栏导航、联系人管理、即将到来列表、一键测试通知
- 💾 数据持久化在 `./data` 卷（SQLite + config.yaml），重装/升级不丢失
- ⏰ 内置定时任务，每天定点检查（默认 08:00，前台可改）

## 👥 用户与权限

| 能力 | 管理员 | 普通用户 |
|------|:------:|:--------:|
| 联系人增删改查、测试通知 | ✅ | ✅ |
| 查看「即将到来」 | ✅ | ✅ |
| 修改系统设置（提醒时间/渠道参数等） | ✅ | ❌ |
| 新增 / 删除用户 | ✅ | ❌ |
| 手动触发全量检查 | ✅ | ❌ |

- **首次访问**网页会引导创建管理员账号（无需改配置文件）。
- 管理员可在「用户管理」中给家人各建一个账号，共同维护生日名单。
- 登录状态保留 30 天；密码使用 PBKDF2 加密存储；删除用户会立即使其登录失效。
- 安全兜底：不能删除自己、不能删除最后一个管理员。

## 📁 目录结构

```
birthday-keeper/
├── Dockerfile
├── docker-compose.yml
├── requirements.txt
├── config.yaml.example        # 配置模板（v2 也可全程在网页设置，不必手改）
├── app/
│   ├── main.py                # FastAPI 接口（鉴权 / 生日 / 设置 / 用户）
│   ├── auth.py                # 密码哈希 + 会话令牌（零额外依赖）
│   ├── db.py                  # SQLite：生日 + 用户 + 会话 + 通知去重
│   ├── config.py              # 配置加载 / 保存 / 热更新
│   ├── lunar.py               # 农历转公历
│   ├── scheduler.py           # 每日检查 + 动态改时刻
│   └── notifiers/             # 各渠道发送实现
├── static/
│   ├── index.html             # 单页应用入口
│   ├── css/styles.css         # 现代简约样式
│   └── js/app.js              # 前端逻辑（含设置页参数说明）
└── data/                      # 运行时生成：config.yaml / birthday.db
```

## 🚀 在群晖 (Synology) 上部署

镜像由 GitHub Actions **自动构建并发布到 GitHub 容器仓库（GHCR）**，已设为**公开、可免登录拉取**。因此你可以直接拉取运行 —— **不用克隆仓库、不用本地构建**。

> 镜像架构为 `linux/amd64`，适用于 x86_64 群晖（Intel / AMD 机型）。若你的 NAS 是 ARM 架构（部分 DSxxxplay 机型），请告诉我，我改成多架构镜像。

### 方式一：一行命令部署（最省事，推荐）

SSH 登录群晖后直接执行，镜像会自动从 GHCR 在线下载，**无需任何文件**：

```bash
docker run -d \
  --name birthday-keeper \
  --restart unless-stopped \
  -p 8000:8000 \
  -v /volume1/docker/birthday-keeper/data:/app/data \
  -e TZ=Asia/Shanghai \
  ghcr.io/marcusyean/birthday-keeper:latest
```

完成后浏览器访问 `http://群晖IP:8000` 创建管理员即可。

### 方式二：Container Manager 图形界面（粘贴 compose）

1. 打开 **Container Manager → 项目 → 新增**。
2. 在 compose 编辑框**粘贴**以下内容（无需克隆仓库）：

```yaml
services:
  birthday-keeper:
    image: ghcr.io/marcusyean/birthday-keeper:latest
    container_name: birthday-keeper
    restart: unless-stopped
    ports:
      - "8000:8000"
    environment:
      - TZ=Asia/Shanghai
    volumes:
      - ./data:/app/data
```

3. 项目路径选 `/volume1/docker/birthday-keeper`（`./data` 卷会自动创建），点击部署。
4. 浏览器访问 `http://群晖IP:8000` 创建管理员。

### 方式三：docker compose 文件（如需）

若你想用 compose 文件管理，只需新建一个 `docker-compose.yml`（内容同上），然后：

```bash
mkdir -p /volume1/docker/birthday-keeper && cd /volume1/docker/birthday-keeper
# 把上面的 compose 内容保存为 docker-compose.yml
docker compose up -d
```

### 升级

镜像在每次推送 `main` 时由 GitHub Actions 自动重建。升级只需拉取新镜像：

```bash
docker pull ghcr.io/marcusyean/birthday-keeper:latest
docker compose up -d          # 若用方式一(docker run)，先 docker rm -f birthday-keeper 再重跑该命令
```

数据始终在 `./data` 卷，升级不丢失。

### 端口与反代

- 默认映射宿主 `8000` 端口。如需改端口，编辑 `docker-compose.yml` 的 `ports`（如 `"9000:8000"`）。
- 想用 `https://你的域名/birthday` 访问：在群晖 **反向代理** 中把 `/birthday` 转到 `localhost:8000`，并把端口映射改成仅本机（如 `"127.0.0.1:8000:8000"`）。

## ⚙️ 配置通知渠道（全部在网页完成）

用管理员登录 → 左侧「**设置**」。每个参数下方都有说明文字，按提示填写即可，**保存后立即生效，无需重启容器**。

### 微信推送（任选一种服务）

| 类型 | 选择 | 获取方式 |
|------|------|----------|
| Server酱 | `Server酱` | 登录 [sct.ftqq.com](https://sct.ftqq.com) → 复制 `SendKey` 填入「推送 Token」 |
| PushPlus | `PushPlus` | 登录 [pushplus.plus](http://www.pushplus.plus) → 复制 `token` |
| Bark | `Bark` | iOS 安装 Bark App，复制设备 key |

### 飞书机器人

1. 飞书群 → 设置 → 群机器人 → 添加「自定义机器人」，复制 Webhook 地址填入设置页。
2. 若开启了「签名校验」，把生成的密钥填入「签名密钥」；未开启则留空。

### 邮件（可选）

在设置页打开「启用邮件通知」，按各字段说明填入 SMTP 服务器、端口、账号与**授权码**（不是登录密码）。

## 🧪 验证

- 添加一位联系人 → 点「测试」按钮，对应渠道应立刻收到消息（渠道未配置时会返回明确的失败原因）。
- 想立刻看到正式提醒效果：把某人生日设为「今天」、提前天数填 `0`，再在设置页把「每日检查时间」改到 1 分钟后。

## 🛠️ 常用运维

```bash
docker compose logs -f          # 查看运行日志
docker compose down             # 停止并移除容器（数据仍在 ./data）
```

## ❓ 常见问题

- **忘记管理员密码？** 删除 `./data/birthday.db` 中的用户（或整库删除后重建），重启容器后会重新进入初始化引导。⚠️ 整库删除会连生日数据一起清空，建议先备份。
- **农历生日对不上？** 农历存在闰月，若是闰月生日请在编辑时勾选「闰月」。普通农历无需勾选。
- **收不到通知？** 先点「测试」看返回信息；再检查设置页对应渠道是否「启用」、Token/Webhook 是否正确。
- **重复收到？** 已发送记录写入 `notify_log` 去重；修改系统时间或重装数据库会重置去重。
- **数据备份？** 直接备份 `./data` 文件夹（含 `birthday.db` 与 `config.yaml`）即可。
