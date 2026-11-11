// IPC 在父进程关闭或意外终止时都会断开，子进程沿用各自的关闭逻辑。
process.once('disconnect', () => {
  setTimeout(() => process.exit(1), 15000).unref()
  if (!process.emit('SIGTERM')) process.exit(0)
})
process.channel?.unref()
