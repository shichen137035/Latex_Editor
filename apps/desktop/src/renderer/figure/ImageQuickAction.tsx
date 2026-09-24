export function ImageQuickAction({ onOpen }: { onOpen(): void }) {
  return <div className="image-quick-action"><button title="Insert image" onClick={onOpen}><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 5h16v14H4zM6 16l4-4 3 3 2-2 3 3M8 9h.01"/></svg><span>Fig</span></button></div>;
}
