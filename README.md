# DSH 插件集

这里是给 [DeepSeek Harness](https://www.deepseek.com/harness/)（DSH）Web 界面写的自用插件

<img width="1409" height="1064" alt="preview-notifier-cost" src="https://github.com/user-attachments/assets/4c1b5b8e-be49-4511-a8af-de9a32da01de" />

## 安装到 web profile

1. 插件文件夹移动到 `.dsh\profiles\web\packages\` 文件夹下（没有则创建），链接进 `profile` 的 `node_modules`

以下是PowerShell方式：
```pwsh
$base = Join-Path $env:USERPROFILE ".dsh\profiles"
New-Item -ItemType Junction `
  -Path   "$base\node_modules\<plugin-name>" `
  -Target "$base\web\packages\<plugin-name>"
```

以下是macOS/Linux方式：`ln -s <目标> <链接>`
```sh
base="$HOME/.dsh/profiles"
ln -s "$base/web/packages/<plugin-name>" "$base/node_modules/<plugin-name>"
```

2. 在 ~/.dsh/profiles/web/cordis.patch.yml 顶层数组里插入条目
```yaml
- insert:
  - id: <plugin-id>
    name: '<plugin-name>'
```

# 3. 启动 dsh web 服务
```
dsh web
```
