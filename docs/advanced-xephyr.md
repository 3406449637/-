# 进阶：把播放器放进独立显示

> 这是可选方案，适合 Linux + Edge。普通使用不需要看这一页。
>
> 雨课堂播放器会在页面失去焦点或切到后台时暂停。独立显示只是让浏览器在一个**真实存在的独立桌面里保持前台焦点**，不修改页面代码，也不伪造焦点信号。

## 适用场景

- 同一台 Linux 电脑上，希望视频标签页保持前台，同时主桌面继续处理其他窗口；
- 愿意接受平台仍然限制倍速、并发和统计规则；
- 不用于绕过课程规则或刷进度。

## Linux + Edge：Xephyr

### 1. 安装依赖

```bash
sudo apt update
sudo apt install -y xephyr openbox
```

### 2. 运行项目自带的启动脚本

```bash
cd <项目目录>
./scripts/start-ykt-player.sh
```

脚本会自动：

1. 选择一个空闲显示号（通常是 `:2`）；
2. 启动 Xephyr；
3. 在 Xephyr 里启动 openbox；
4. 用独立配置目录启动 Edge，并强制使用 X11。

日志在：

```text
~/.ykt-player-logs/
```

### 3. 在 Xephyr 的 Edge 中准备

这是一个全新的 Edge 配置，需要重新完成：

1. 登录雨课堂；
2. 安装 Tampermonkey；
3. 在 `edge://extensions` → Tampermonkey → 详细信息里打开“允许用户脚本”；
4. 安装/更新本项目的 `yuketang-video-queue.user.js`；
5. 允许本站弹窗；
6. 打开课程页，开始队列。

### 4. 使用

把 Xephyr 窗口放到另一个虚拟桌面或副屏，**不要最小化**；主桌面继续使用其他窗口。

队列运行时，只让 Xephyr 里的 Edge 保持焦点。不要在里面再打开其他窗口。

### 5. 验证焦点

在 Xephyr 的 Edge 里按 F12，Console 运行：

```js
setInterval(() => {
  console.log(
    new Date().toLocaleTimeString(),
    'hasFocus=', document.hasFocus(),
    'hidden=', document.hidden,
    'paused=', document.querySelector('video')?.paused
  );
}, 1000);
```

切到主桌面几秒再切回来：

- `hasFocus=false` + `paused=true`：独立显示没有隔离焦点，或 Edge 没获得焦点；
- `hasFocus=true` + `paused=false`：正常。

## Windows / macOS

Xephyr 只适用于 Linux/X11。Windows 或 macOS 可以用：

- 虚拟机：在 VirtualBox / VMware / Parallels 里装一个轻量系统，在 guest 中运行 Edge 和脚本；
- 或第二台设备：旧笔记本、备用机。

把虚拟机窗口或第二台设备放在旁边，让 guest 中的 Edge 保持前台即可。宿主机的焦点不会影响 guest 内部的页面焦点。

## 仍然存在的限制

- 平台服务端会按实际时间校验进度，超过 2 倍速仍可能回滚；
- 同一账号的并发会话可能互相覆盖，不建议并行；
- 站点改版后播放器菜单结构可能变化；
- 不要用这种方式伪造观看、绕过防挂机或进行多账号操作。

项目的普通使用方式仍然是：**课程页启动队列，视频标签页保持前台，2 倍速串行播放。**
