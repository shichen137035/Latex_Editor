const assert = require('node:assert/strict');

/** Shared with the real AI review check: no providers or profiling hooks in the app. */
module.exports = async function checkRendererPerformance({ page, evaluate, until, conversation }) {
  await evaluate("Array.from(document.querySelectorAll('.view-switch button')).find(button=>button.textContent.trim()==='Code')?.click()");
  await until("!!document.querySelector('.editor-surface .monaco-editor') && !document.querySelector('.monaco-diff-editor')", 'source editor for AI performance check');
  const history = structuredClone(conversation);
  history.messages = [];
  const start = Date.now() - 120000;
  for (let index = 0; index < 60; index++) {
    history.messages.push({ id: `user-${index}`, role: 'user', content: `Request ${index}`, createdAt: start + index * 1000 });
    history.messages.push({ id: `answer-${index}`, role: 'assistant', content: `Answer ${index}: $x^2+y^2$\n\n` + 'A completed result with **formatting**.\n\n'.repeat(15), createdAt: start + index * 1000 + 1, completedAt: start + index * 1000 + 500, status: 'complete', reasoning: [{ id: `thought-${index}`, text: 'A long thought summary with $z^2$.\n\n'.repeat(80), complete: true }] });
  }
  history.updatedAt = Date.now();
  history.revision = (history.revision ?? 0) + 1;
  page.webContents.send('ai:update', { kind: 'conversation', payload: history });
  await until("document.querySelectorAll('.ai-message').length===120", 'long AI history loaded');
  assert.equal(await evaluate("document.querySelectorAll('.ai-reasoning-content').length"), 0, 'closed summaries must not mount rich content');

  // Read the current React tree only inside the disposable test. A memo bailout
  // retains its props identity; this detects hidden re-renders without app instrumentation.
  await evaluate(`(() => {
    const host = document.querySelector('.ai-message');
    let fiber = host[Object.keys(host).find(key => key.startsWith('__reactFiber$'))];
    while (fiber.return) fiber = fiber.return;
    const root = fiber.stateNode;
    window.aiPerformanceProps = predicate => {
      const visit = node => {
        if (!node) return;
        if (predicate(node.memoizedProps)) return node.memoizedProps;
        return visit(node.child) ?? visit(node.sibling);
      };
      return visit(root.current);
    };
    window.aiTranscriptBefore = window.aiPerformanceProps(props => props?.readyKey && Array.isArray(props.messages) && props.actions);
    window.aiHistoryBefore = window.aiPerformanceProps(props => props?.message?.id==='answer-0' && props.actions);
    if (!window.aiTranscriptBefore || !window.aiHistoryBefore) throw new Error('Missing AI memo boundaries');
    window.aiSetComposer = value => {
      const input = document.querySelector('.ai-composer textarea');
      Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value').set.call(input,value);
      input.dispatchEvent(new Event('input', {bubbles:true}));
    };
    window.aiSetComposer('Draft');
  })()`);
  await evaluate('new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))');
  assert.ok(await evaluate("window.aiTranscriptBefore===window.aiPerformanceProps(props=>props?.readyKey && Array.isArray(props.messages) && props.actions)"), 'typing must not re-render the transcript');

  const typing = await evaluate(`(async () => {
    const input = document.querySelector('.ai-composer textarea');
    const samples = [];
    for (let index = 0; index < 25; index++) {
      const start = performance.now();
      window.aiSetComposer(input.value + ' typing');
      await new Promise(resolve=>requestAnimationFrame(resolve));
      samples.push(performance.now()-start);
    }
    window.aiSetComposer(Array.from({length:40},(_,index)=>'Long input line '+index).join('\\n'));
    await new Promise(resolve=>requestAnimationFrame(resolve));
    input.scrollTop = input.scrollHeight;
    samples.sort((a,b)=>a-b);
    return { medianFrameMs:samples[12],p95FrameMs:samples[23],height:input.getBoundingClientRect().height,
      scrollHeight:input.scrollHeight,scrollTop:input.scrollTop,inlineHeight:input.style.height };
  })()`);
  assert.ok(typing.height <= 111 && typing.height >= 44, 'composer height stays capped');
  assert.ok(typing.scrollHeight > typing.height && typing.scrollTop > 0, 'long input scrolls inside the composer');
  assert.equal(typing.inlineHeight, '', 'typing must not repeatedly force JS height measurements');

  await evaluate("document.querySelector('.ai-composer-expand').click()");
  await until("!!document.querySelector('.ai-composer-expanded-panel')", 'expanded composer');
  assert.ok(await evaluate("document.querySelector('.ai-composer textarea').getBoundingClientRect().height>200 && document.querySelector('.ai-composer textarea').value.includes('Long input line 39')"), 'expanding keeps the long draft');
  await evaluate("document.querySelector('.ai-composer-expand').click()");
  await until("!document.querySelector('.ai-composer-expanded-panel')", 'composer collapsed');

  await evaluate(`(() => {
    const element=document.querySelector('.editor-surface');
    let fiber=element[Object.keys(element).find(key=>key.startsWith('__reactFiber$'))];
    for (;fiber;fiber=fiber.return) for (let hook=fiber.memoizedState;hook;hook=hook.next) {
      const editor=hook.memoizedState?.current;
      if (editor && typeof editor.getModel==='function' && typeof editor.executeEdits==='function') {
        const model=editor.getModel(),line=model.getLineCount(),column=model.getLineMaxColumn(line);
        editor.executeEdits('ai-performance',[{range:{startLineNumber:line,startColumn:column,endLineNumber:line,endColumn:column},text:'\\n% editor stays responsive'}]);
        return;
      }
    }
    throw new Error('Missing source editor');
  })()`);
  await evaluate('new Promise(resolve=>setTimeout(resolve,300))');
  assert.ok(await evaluate("window.aiTranscriptBefore===window.aiPerformanceProps(props=>props?.readyKey && Array.isArray(props.messages) && props.actions)"), 'editing source must not rebuild AI history when macros are unchanged');

  const delta = structuredClone(history);
  delta.messages.push({ id:'stream-performance',role:'assistant',content:'',status:'streaming',createdAt:Date.now() });
  for (let index=1;index<=30;index++) {
    delta.updatedAt++; delta.revision++;
    delta.messages.at(-1).content = `Stream result ${index}`;
    page.webContents.send('ai:update',{kind:'conversation',payload:structuredClone(delta)});
  }
  delta.messages.at(-1).status='complete'; delta.messages.at(-1).completedAt=Date.now(); delta.updatedAt++; delta.revision++;
  page.webContents.send('ai:update',{kind:'conversation',payload:delta});
  await until("document.querySelector('.ai-message:last-child')?.textContent.includes('Stream result 30')", 'final stream retained');
  assert.ok(await evaluate("window.aiHistoryBefore===window.aiPerformanceProps(props=>props?.message?.id==='answer-0' && props.actions)"), 'streaming must preserve completed message renders');
  await evaluate(`(() => { const summary=document.querySelector('.ai-reasoning summary');summary.scrollIntoView();summary.click(); })()`);
  await until("document.querySelector('.ai-reasoning-content')?.textContent.includes('long thought summary')", 'lazy summary expanded');
  console.log('PASS AI performance: 120 messages; typing/source edits skip history renders; stream updates preserve completed messages; lazy summaries; capped and expanded composer. Profile: '+JSON.stringify(typing));
};
