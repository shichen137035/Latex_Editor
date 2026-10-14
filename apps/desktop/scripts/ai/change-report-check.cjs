const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');

module.exports = async function checkChangeReports({ project, evaluate, until, conversation, changeSets, hunk, publish }) {
  const readSource = () => evaluate(`window.latexEditor.files.read(${JSON.stringify(project.id)},'main.tex').then(file=>file.content)`);
  const card = "document.querySelector('.ai-change-path[title=\"main.tex\"]')?.closest('.ai-change-set')";
  const original = await readSource();
  const firstContent = original.replace('Ask edit', 'Grouped intermediate');
  const finalContent = original.replace('Ask edit', 'Grouped final');
  assert.notEqual(original, firstContent);
  for (const action of ['undo', 'dismiss-report']) {
    const messageId = randomUUID(), time = Date.now();
    const checkpoint = (before, after, index) => ({
      id: randomUUID(), conversationId: conversation.id, messageId, createdAt: time + index,
      permissionMode: 'auto', status: 'pending', files: [{ path:'main.tex', type:'modify', originalContent:before,
        proposedContent:after, status:'pending', hunks:[hunk(randomUUID(),0,before,after)] }]
    });
    const first = checkpoint(original, firstContent, 0), second = checkpoint(firstContent, finalContent, 1);
    for (const changes of [first, second]) {
      changeSets.push(changes); publish(changes);
      await until(`${card}?.querySelector('[data-action=undo]') && !${card}?.querySelector('[data-action=reject-all]')`, 'checkpoint applied');
      await until(`window.latexEditor.files.read(${JSON.stringify(project.id)},'main.tex').then(file=>file.content===${JSON.stringify(changes.files[0].proposedContent)})`, 'checkpoint saved');
    }
    assert.equal(await evaluate("document.querySelectorAll('.ai-change-path[title=\"main.tex\"]').length"), 1, 'one response must have one card/file entry');
    assert.equal(await evaluate(`${card}.querySelector('.ai-diff-count.added').textContent`), '+1');
    assert.equal(await evaluate(`${card}.querySelector('.ai-diff-count.removed').textContent`), '−1');
    if (action === 'undo') {
      // AI edits schedule a compile that reveals PDF; let that finish before explicitly opening the diff.
      await evaluate('new Promise(resolve=>setTimeout(resolve,500))');
      await evaluate(`${card}.querySelector('[data-action=view-changes]').click()`);
      await until("(()=>{ const text=document.querySelector('.monaco-diff-editor')?.textContent?.replaceAll('\\u00a0',' '); return text?.includes('Ask edit') && text?.includes('Grouped final'); })()", 'cumulative source diff');
      await evaluate("document.querySelector('.ai-diff-close').click()");
      await until("!document.querySelector('.monaco-diff-editor')", 'diff closed');
    }
    await evaluate(`${card}.querySelector('header [data-action=${action}]').click()`);
    await until(`!${card}`, 'merged report resolved');
    const expected = action === 'undo' ? original : finalContent;
    await until(`window.latexEditor.files.read(${JSON.stringify(project.id)},'main.tex').then(file=>file.content===${JSON.stringify(expected)})`, 'merged report source result');
    if (action === 'dismiss-report') assert.ok(!changeSets.some(changes=>changes.messageId===messageId), 'clearing removes every checkpoint report');
  }
  console.log('PASS merged AI reports: one file/card, net counters, cumulative source diff, reverse-order Undo and whole-report clearing.');
};
