export function shouldRenderStandaloneTypingDots(
  isProcessing: boolean,
  activeTurnId: string | null,
  turnMessageId: string | null,
): boolean {
  return isProcessing && activeTurnId === null && turnMessageId === null
}

export function TypingDots() {
  return (
    <div className="msg assistant">
      <div className="bubble typing">
        <span className="dot" />
        <span className="dot" />
        <span className="dot" />
      </div>
    </div>
  )
}
