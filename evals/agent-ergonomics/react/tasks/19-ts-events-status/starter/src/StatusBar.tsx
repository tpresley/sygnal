type StatusBarProps = {
  message: string
}

export default function StatusBar({ message }: StatusBarProps) {
  return <footer className="status-bar">{message}</footer>
}
