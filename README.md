# DSH 插件集

这里是给 [DeepSeek Harness](https://deepseek-harness.github.io/deepseek-harness/)（DSH）Web 界面写的自用插件


## 安装到 web profile

两个插件的部署方式相同，**三步**：

```sh
# 1. 把包体链接进 profile 的 node_modules
#    Windows 请用目录联接（junction）；Git Bash / WSL 下可用 ln -s
cmd /c mklink /J "%USERPROFILE%\.dsh\profiles\node_modules\dsh-cost-meter" "%USERPROFILE%\.dsh\profiles\web\packages\dsh-cost-meter"
cmd /c mklink /J "%USERPROFILE%\.dsh\profiles\node_modules\dsh-notifier"   "%USERPROFILE%\.dsh\profiles\web\packages\dsh-notifier"

# 2. 在 ~/.dsh/profiles/web/cordis.patch.yml 顶层数组里插入条目
#    - insert:
#        - id: cost-meter
#          name: 'dsh-cost-meter'
#        - id: notifier
#          name: 'dsh-notifier'

# 3. 启动 web 服务
dsh web
```
