import messages from "./locales/en.json" with { type: "json" };
import japanese from "./locales/ja.json" with { type: "json" };
import simplifiedChinese from "./locales/zh-CN.json" with { type: "json" };
import traditionalChinese from "./locales/zh-TW.json" with { type: "json" };
import korean from "./locales/ko.json" with { type: "json" };
import french from "./locales/fr.json" with { type: "json" };

type MessageKey = keyof typeof messages;
export type Locale = "en" | "ja" | "zh-CN" | "zh-TW" | "ko" | "fr";
const catalogs: Record<Locale, Record<string, string>> = {
  en: messages as Record<string, string>, ja: japanese as Record<string, string>,
  "zh-CN": simplifiedChinese as Record<string, string>, "zh-TW": traditionalChinese as Record<string, string>,
  ko: korean as Record<string, string>, fr: french as Record<string, string>
};
const resourcePickerLabels: Record<Locale, [string, string, string]> = {
  en: ["Choose a resource…", "Add resource", "Remove resource"],
  ja: ["リソースを選択…", "リソースを追加", "リソースを削除"],
  "zh-CN": ["选择资源…", "添加资源", "移除资源"],
  "zh-TW": ["選擇資源…", "新增資源", "移除資源"],
  ko: ["리소스 선택…", "리소스 추가", "리소스 제거"],
  fr: ["Choisir une ressource…", "Ajouter la ressource", "Retirer la ressource"]
};
for (const [language, [choose, add, remove]] of Object.entries(resourcePickerLabels)) {
  const catalog = catalogs[language as Locale];
  catalog["resource.chooseCustom"] = choose;
  catalog["resource.addToProject"] = add;
  catalog["resource.removeFromProject"] = remove;
}
const aiComposerMessages: Record<Locale, string[]> = {
  en: ["Add attachments", "Remove {{name}}", "Please examine the attached files.", "Thought summary", "Working…", "Responding…"],
  ja: ["添付ファイルを追加", "{{name}} を削除", "添付ファイルを確認してください。", "思考の概要", "作業中…", "回答中…"],
  "zh-CN": ["添加附件", "移除 {{name}}", "请查看附加的文件。", "思考摘要", "处理中…", "回答中…"],
  "zh-TW": ["新增附件", "移除 {{name}}", "請查看附加的檔案。", "思考摘要", "處理中…", "回答中…"],
  ko: ["첨부 파일 추가", "{{name}} 제거", "첨부 파일을 확인해 주세요.", "생각 요약", "작업 중…", "응답 중…"],
  fr: ["Ajouter des pièces jointes", "Retirer {{name}}", "Veuillez examiner les fichiers joints.", "Résumé de réflexion", "Travail en cours…", "Réponse en cours…"]
};
const aiComposerKeys = ["ai.addAttachment", "ai.removeAttachment", "ai.attachmentPrompt", "ai.thoughtSummary", "ai.working", "ai.responding"];
for (const [language, labels] of Object.entries(aiComposerMessages)) {
  for (const [index, key] of aiComposerKeys.entries()) catalogs[language as Locale][key] = labels[index]!;
}
const aiTranscriptMessages: Record<Locale, [string, string]> = {
  en: ["Stopping…", "Scroll to latest message"],
  ja: ["停止中…", "最新のメッセージへ移動"],
  "zh-CN": ["正在停止…", "滚动到最新消息"],
  "zh-TW": ["正在停止…", "捲動至最新訊息"],
  ko: ["중지 중…", "최신 메시지로 이동"],
  fr: ["Arrêt en cours…", "Aller au dernier message"]
};
for (const [language, [stopping, scrollToLatest]] of Object.entries(aiTranscriptMessages)) {
  catalogs[language as Locale]["ai.stopping"] = stopping;
  catalogs[language as Locale]["ai.scrollToLatest"] = scrollToLatest;
}
const aiLongInputMessages: Record<Locale, [string, string]> = {
  en: ["Long message will be saved as a project .txt file when sent.", "Read the full request in {{path}} before replying."],
  ja: ["長いメッセージは送信時にプロジェクト内の .txt ファイルとして保存されます。", "返信する前に {{path}} を読み、全文を依頼内容として扱ってください。"],
  "zh-CN": ["发送时，超长内容会自动保存为项目中的 .txt 文件。", "请先读取 {{path}} 中的完整内容，并将其作为我的完整请求处理。"],
  "zh-TW": ["送出時，過長內容會自動儲存為專案中的 .txt 檔案。", "請先讀取 {{path}} 中的完整內容，並將其視為我的完整請求。"],
  ko: ["긴 메시지는 전송할 때 프로젝트의 .txt 파일로 저장됩니다.", "답변하기 전에 {{path}}의 전체 내용을 읽고 요청으로 처리하세요."],
  fr: ["Le long message sera enregistré dans un fichier .txt du projet à l’envoi.", "Lisez {{path}} en entier avant de répondre et traitez-le comme ma demande complète."]
};
for (const [language, [hint, prompt]] of Object.entries(aiLongInputMessages)) {
  catalogs[language as Locale]["ai.longMessageHint"] = hint;
  catalogs[language as Locale]["ai.longMessagePrompt"] = prompt;
}
const aiCopyPathLabels: Record<Locale, string> = {
  en: "Copy file path", ja: "ファイルパスをコピー", "zh-CN": "复制文件路径", "zh-TW": "複製檔案路徑", ko: "파일 경로 복사", fr: "Copier le chemin"
};
for (const [language, label] of Object.entries(aiCopyPathLabels)) catalogs[language as Locale]["ai.copyPath"] = label;
const projectExportMessages: Record<Locale, string[]> = {
  en: ["Export source archive (.zip)", "Export PDF", "Export main .tex file", "No main TeX file is configured.", "Export saved to:\n{{path}}", "PDF export failed. See the Problems panel for details."],
  ja: ["ソース一式を ZIP でエクスポート", "PDF をエクスポート", "メイン .tex ファイルをエクスポート", "メインの TeX ファイルが設定されていません。", "エクスポートしました:\n{{path}}", "PDF の生成に失敗しました。問題パネルを確認してください。"],
  "zh-CN": ["导出源码压缩包 (.zip)", "导出 PDF", "导出主 .tex 文件", "尚未设置主 TeX 文件。", "已导出到：\n{{path}}", "PDF 导出失败，请查看问题面板。"],
  "zh-TW": ["匯出原始碼壓縮檔 (.zip)", "匯出 PDF", "匯出主要 .tex 檔案", "尚未設定主要 TeX 檔案。", "已匯出至：\n{{path}}", "PDF 匯出失敗，請查看問題面板。"],
  ko: ["소스 압축 파일 내보내기 (.zip)", "PDF 내보내기", "주 .tex 파일 내보내기", "주 TeX 파일이 설정되지 않았습니다.", "내보냈습니다:\n{{path}}", "PDF 내보내기에 실패했습니다. 문제 패널을 확인하세요."],
  fr: ["Exporter les sources (.zip)", "Exporter le PDF", "Exporter le fichier .tex principal", "Aucun fichier TeX principal n’est défini.", "Export enregistré ici :\n{{path}}", "L’export PDF a échoué. Consultez le panneau Problèmes."]
};
const projectExportKeys = ["export.sourceArchive", "export.pdf", "export.mainTex", "export.noMainTex", "export.saved", "export.pdfFailed"];
for (const [language, labels] of Object.entries(projectExportMessages)) {
  for (const [index, key] of projectExportKeys.entries()) catalogs[language as Locale][key!] = labels[index]!;
}
for (const catalog of Object.values(catalogs)) catalog["ai.chat"] = "Copilot";
const historyMessages: Record<Locale, string[]> = {
  en: ["Conversations", "Close", "Search chats…", "No conversations found", "Today", "Yesterday", "Last 7 days", "Earlier", "Select {{title}}", "{{count}} messages", "Delete {{title}}", "Delete {{count}} conversations and their local AI changes?", "Cancel", "Deleting…", "Delete", "Select visible", "Delete selected ({{count}})"],
  ja: ["会話の管理", "閉じる", "会話を検索…", "会話がありません", "今日", "昨日", "過去7日間", "それ以前", "{{title}}を選択", "{{count}}件のメッセージ", "{{title}}を削除", "{{count}}件の会話とローカルのAI変更を削除しますか？", "キャンセル", "削除中…", "削除", "表示中を選択", "選択を削除（{{count}}）"],
  "zh-CN": ["对话管理", "关闭", "搜索对话…", "没有找到对话", "今天", "昨天", "最近7天", "更早", "选择{{title}}", "{{count}}条消息", "删除{{title}}", "删除这{{count}}个对话及其本地AI修改记录？", "取消", "正在删除…", "删除", "选择当前列表", "删除所选（{{count}}）"],
  "zh-TW": ["對話管理", "關閉", "搜尋對話…", "找不到對話", "今天", "昨天", "最近7天", "更早", "選取{{title}}", "{{count}}則訊息", "刪除{{title}}", "刪除這{{count}}個對話及其本機AI修改記錄？", "取消", "正在刪除…", "刪除", "選取目前清單", "刪除所選（{{count}}）"],
  ko: ["대화 관리", "닫기", "대화 검색…", "대화가 없습니다", "오늘", "어제", "최근 7일", "이전", "{{title}} 선택", "메시지 {{count}}개", "{{title}} 삭제", "대화 {{count}}개와 로컬 AI 변경 기록을 삭제할까요?", "취소", "삭제 중…", "삭제", "표시된 항목 선택", "선택 삭제 ({{count}})"],
  fr: ["Conversations", "Fermer", "Rechercher…", "Aucune conversation", "Aujourd’hui", "Hier", "7 derniers jours", "Plus anciennes", "Sélectionner {{title}}", "{{count}} messages", "Supprimer {{title}}", "Supprimer ces {{count}} conversations et leurs modifications IA locales ?", "Annuler", "Suppression…", "Supprimer", "Sélectionner la liste", "Supprimer la sélection ({{count}})"]
};
const historyKeys = ["manage", "close", "search", "empty", "today", "yesterday", "week", "older", "select", "messages", "deleteOne", "confirm", "cancel", "deleting", "delete", "selectAll", "deleteSelected"];
for (const [language, labels] of Object.entries(historyMessages)) {
  for (const [index, key] of historyKeys.entries()) catalogs[language as Locale][`ai.history.${key}`] = labels[index]!;
}
const reasoningMessages: Record<Locale, string[]> = {
  en: ["Thinking depth", "Model default", "Applies to the next message.", "Choose a model that supports thinking depth.", "None", "Minimal", "Low", "Medium", "High", "Extra high", "Maximum", "Ultra"],
  ja: ["思考の深さ", "モデルの既定値", "次のメッセージから適用されます。", "思考の深さを設定できるモデルを選択してください。", "なし", "最小", "低", "中", "高", "非常に高い", "最大", "超高"],
  "zh-CN": ["思考深度", "模型默认", "从下一条消息开始生效。", "请选择支持调节思考深度的模型。", "无", "极低", "低", "中", "高", "极高", "最大", "超高"],
  "zh-TW": ["思考深度", "模型預設", "從下一則訊息開始生效。", "請選擇支援調整思考深度的模型。", "無", "極低", "低", "中", "高", "極高", "最大", "超高"],
  ko: ["사고 깊이", "모델 기본값", "다음 메시지부터 적용됩니다.", "사고 깊이 조절을 지원하는 모델을 선택하세요.", "없음", "최소", "낮음", "중간", "높음", "매우 높음", "최대", "초고"],
  fr: ["Profondeur de réflexion", "Valeur du modèle", "S’applique au prochain message.", "Choisissez un modèle proposant ce réglage.", "Aucune", "Minimale", "Faible", "Moyenne", "Élevée", "Très élevée", "Maximale", "Ultra"]
};
const reasoningKeys = ["ai.reasoningEffort", "ai.modelDefault", "ai.reasoningHint", "ai.reasoningUnavailable", "ai.effort.none", "ai.effort.minimal", "ai.effort.low", "ai.effort.medium", "ai.effort.high", "ai.effort.xhigh", "ai.effort.max", "ai.effort.ultra"];
for (const [language, labels] of Object.entries(reasoningMessages)) {
  for (const [index, key] of reasoningKeys.entries()) catalogs[language as Locale][key] = labels[index]!;
}
const skillMessages: Record<Locale, string[]> = {
  en: ["AI skills", "Project skills", "Manage the instructions AI uses for LaTeX projects. Built-in skills are copied to your user data when edited.", "New skill", "No skills are available.", "Skill folder name", "Keep the YAML front matter with name and description; the folder name uses lowercase letters, numbers, and hyphens.", "Skill instructions (SKILL.md)", "Cancel", "Saving…", "Save skill", "Edit", "Select a skill to view or edit its instructions.", "Built-in", "Custom", "Customized"],
  ja: ["AI スキル", "プロジェクトスキル", "LaTeX プロジェクトで AI が使う指示を管理します。組み込みスキルを編集するとユーザーデータにコピーして保存します。", "新しいスキル", "利用できるスキルはありません。", "スキルフォルダー名", "name と description を含む YAML ヘッダーを残してください。フォルダー名には小文字、数字、ハイフンを使います。", "スキルの指示 (SKILL.md)", "キャンセル", "保存中…", "スキルを保存", "編集", "スキルを選択して指示を表示または編集します。", "組み込み", "カスタム", "編集済み"],
  "zh-CN": ["AI 技能", "项目技能", "管理 AI 在 LaTeX 项目中使用的指引。编辑内置技能时，会将副本保存到用户数据目录。", "新建技能", "暂无可用技能。", "技能文件夹名称", "请保留包含 name 和 description 的 YAML 头部；文件夹名使用小写字母、数字和连字符。", "技能说明（SKILL.md）", "取消", "保存中…", "保存技能", "编辑", "选择一项技能以查看或编辑说明。", "内置", "自定义", "已自定义"],
  "zh-TW": ["AI 技能", "專案技能", "管理 AI 在 LaTeX 專案中使用的指引。編輯內建技能時，會將副本儲存到使用者資料目錄。", "新增技能", "目前沒有可用技能。", "技能資料夾名稱", "請保留包含 name 與 description 的 YAML 標頭；資料夾名稱使用小寫字母、數字與連字號。", "技能說明（SKILL.md）", "取消", "儲存中…", "儲存技能", "編輯", "選擇一項技能以檢視或編輯說明。", "內建", "自訂", "已自訂"],
  ko: ["AI 스킬", "프로젝트 스킬", "LaTeX 프로젝트에서 AI가 사용하는 지침을 관리합니다. 기본 제공 스킬을 편집하면 사용자 데이터 폴더에 복사해 저장합니다.", "새 스킬", "사용 가능한 스킬이 없습니다.", "스킬 폴더 이름", "name과 description이 있는 YAML 머리말을 유지하세요. 폴더 이름에는 소문자, 숫자, 하이픈을 사용합니다.", "스킬 지침 (SKILL.md)", "취소", "저장 중…", "스킬 저장", "편집", "지침을 보거나 편집할 스킬을 선택하세요.", "기본 제공", "사용자 지정", "수정됨"],
  fr: ["Compétences IA", "Compétences de projet", "Gérez les instructions utilisées par l’IA dans les projets LaTeX. Une compétence intégrée modifiée est copiée dans les données utilisateur.", "Nouvelle compétence", "Aucune compétence disponible.", "Nom du dossier", "Conservez l’en-tête YAML avec name et description ; utilisez des minuscules, chiffres et tirets pour le dossier.", "Instructions (SKILL.md)", "Annuler", "Enregistrement…", "Enregistrer", "Modifier", "Sélectionnez une compétence pour consulter ou modifier ses instructions.", "Intégrée", "Personnalisée", "Modifiée"]
};
const skillKeys = ["settings.aiSkills", "settings.aiSkillsTitle", "settings.aiSkillsDescription", "settings.aiSkillsNew", "settings.aiSkillsEmpty", "settings.aiSkillsName", "settings.aiSkillsFormatHint", "settings.aiSkillsContent", "settings.aiSkillsCancel", "settings.aiSkillsSaving", "settings.aiSkillsSave", "settings.aiSkillsEdit", "settings.aiSkillsSelect", "settings.aiSkillSource.built-in", "settings.aiSkillSource.custom", "settings.aiSkillSource.customized"];
for (const [language, labels] of Object.entries(skillMessages)) {
  for (const [index, key] of skillKeys.entries()) catalogs[language as Locale][key] = labels[index]!;
}
const skillStateMessages: Record<Locale, [string, string]> = {
  en: ["Enabled", "Disabled"], ja: ["有効", "無効"], "zh-CN": ["已启用", "已停用"], "zh-TW": ["已啟用", "已停用"], ko: ["사용 중", "사용 안 함"], fr: ["Activé", "Désactivé"]
};
for (const [language, [enabled, disabled]] of Object.entries(skillStateMessages)) {
  catalogs[language as Locale]["settings.aiSkillsEnabled"] = enabled;
  catalogs[language as Locale]["settings.aiSkillsDisabled"] = disabled;
}
const settingsFooterMessages: Record<Locale, [string, string]> = {
  en: ["Saved automatically", "Project overrides can be reset to global values."],
  ja: ["自動保存済み", "プロジェクト設定はグローバル値に戻せます。"],
  "zh-CN": ["已自动保存", "项目设置可恢复为全局值。"],
  "zh-TW": ["已自動儲存", "專案設定可還原為全域值。"],
  ko: ["자동 저장됨", "프로젝트 설정은 전역 값으로 되돌릴 수 있습니다."],
  fr: ["Enregistré automatiquement", "Les réglages du projet peuvent reprendre les valeurs globales."]
};
for (const [language, [saved, projectReset]] of Object.entries(settingsFooterMessages)) {
  catalogs[language as Locale]["settings.saved"] = saved;
  catalogs[language as Locale]["settings.projectResetHint"] = projectReset;
}
const blockOperationMessages: Record<Locale, Record<string, string>> = {
  en: {
    toolbar: "Block actions", drag: "Drag to move block", disabled: "Disabled block", enable: "Enable", expand: "Expand", collapse: "Collapse",
    duplicate: "Duplicate", paste: "Paste", disable: "Disable", collapseChildren: "Collapse children", expandChildren: "Expand children",
    collapseSiblings: "Collapse siblings", expandAll: "Expand all", previewTitle: "Review block operation", confirm: "Apply",
    "preview.move": "Move {{count}} block(s) and their contents?", "preview.disable": "Disable {{count}} block(s) and their contents?",
    "preview.delete": "Delete {{count}} block(s) and their contents?", moveUp: "Move blocks up", moveDown: "Move blocks down",
    outdent: "Move blocks out one level", indent: "Move blocks into previous sibling", invalidDisabled: "Disabled source needs repair"
  },
  "zh-CN": {
    toolbar: "块操作", drag: "拖动块", disabled: "已关闭的块", enable: "重新启用", expand: "展开", collapse: "收起",
    duplicate: "复制一份", paste: "粘贴", disable: "暂时关闭", collapseChildren: "收起子块", expandChildren: "展开子块",
    collapseSiblings: "收起同级块", expandAll: "全部展开", previewTitle: "确认块操作", confirm: "执行",
    "preview.move": "移动 {{count}} 个块及其全部内容？", "preview.disable": "关闭 {{count}} 个块及其全部内容？",
    "preview.delete": "删除 {{count}} 个块及其全部内容？", moveUp: "上移块", moveDown: "下移块",
    outdent: "提升块层级", indent: "移入前一个同级块", invalidDisabled: "关闭块的源码需要修复"
  },
  "zh-TW": {
    toolbar: "區塊操作", drag: "拖動區塊", disabled: "已停用的區塊", enable: "重新啟用", expand: "展開", collapse: "收合",
    duplicate: "複製一份", paste: "貼上", disable: "暫時停用", collapseChildren: "收合子區塊", expandChildren: "展開子區塊",
    collapseSiblings: "收合同層區塊", expandAll: "全部展開", previewTitle: "確認區塊操作", confirm: "執行",
    "preview.move": "移動 {{count}} 個區塊及其全部內容？", "preview.disable": "停用 {{count}} 個區塊及其全部內容？",
    "preview.delete": "刪除 {{count}} 個區塊及其全部內容？", moveUp: "上移區塊", moveDown: "下移區塊",
    outdent: "提升區塊層級", indent: "移入前一個同層區塊", invalidDisabled: "停用區塊的原始碼需要修復"
  },
  ja: {
    toolbar: "ブロック操作", drag: "ドラッグして移動", disabled: "無効なブロック", enable: "有効にする", expand: "展開", collapse: "折りたたむ",
    duplicate: "複製", paste: "貼り付け", disable: "無効にする", collapseChildren: "子を折りたたむ", expandChildren: "子を展開",
    collapseSiblings: "同階層を折りたたむ", expandAll: "すべて展開", previewTitle: "ブロック操作の確認", confirm: "実行",
    "preview.move": "{{count}} 個のブロックと内容を移動しますか？", "preview.disable": "{{count}} 個のブロックと内容を無効にしますか？",
    "preview.delete": "{{count}} 個のブロックと内容を削除しますか？", moveUp: "上へ移動", moveDown: "下へ移動",
    outdent: "階層を上げる", indent: "前のブロックの中へ移動", invalidDisabled: "無効化されたソースの修復が必要です"
  },
  ko: {
    toolbar: "블록 작업", drag: "드래그하여 이동", disabled: "비활성 블록", enable: "활성화", expand: "펼치기", collapse: "접기",
    duplicate: "복제", paste: "붙여넣기", disable: "비활성화", collapseChildren: "하위 블록 접기", expandChildren: "하위 블록 펼치기",
    collapseSiblings: "같은 단계 접기", expandAll: "모두 펼치기", previewTitle: "블록 작업 확인", confirm: "적용",
    "preview.move": "블록 {{count}}개와 내용을 이동할까요?", "preview.disable": "블록 {{count}}개와 내용을 비활성화할까요?",
    "preview.delete": "블록 {{count}}개와 내용을 삭제할까요?", moveUp: "위로 이동", moveDown: "아래로 이동",
    outdent: "단계 올리기", indent: "이전 블록 안으로 이동", invalidDisabled: "비활성 소스를 복구해야 합니다"
  },
  fr: {
    toolbar: "Actions sur les blocs", drag: "Glisser pour déplacer", disabled: "Bloc désactivé", enable: "Activer", expand: "Déplier", collapse: "Replier",
    duplicate: "Dupliquer", paste: "Coller", disable: "Désactiver", collapseChildren: "Replier les enfants", expandChildren: "Déplier les enfants",
    collapseSiblings: "Replier les voisins", expandAll: "Tout déplier", previewTitle: "Vérifier l’opération", confirm: "Appliquer",
    "preview.move": "Déplacer {{count}} bloc(s) avec leur contenu ?", "preview.disable": "Désactiver {{count}} bloc(s) avec leur contenu ?",
    "preview.delete": "Supprimer {{count}} bloc(s) avec leur contenu ?", moveUp: "Monter les blocs", moveDown: "Descendre les blocs",
    outdent: "Remonter d’un niveau", indent: "Déplacer dans le bloc précédent", invalidDisabled: "La source désactivée doit être réparée"
  }
};
for (const [language, messages] of Object.entries(blockOperationMessages)) {
  for (const [key, value] of Object.entries(messages)) catalogs[language as Locale][`blockOperation.${key}`] = value;
}
Object.assign(catalogs.ja, {
  "ai.copilot": "Copilot", "ai.copilotAccount": "GitHub Copilot アカウント",
  "ai.installCopilot": "TeXWeave 用 GitHub Copilot CLI をインストール", "ai.installingCopilot": "GitHub Copilot CLI をインストール中…",
  "ai.signInGitHub": "GitHub Copilot でサインイン", "ai.copilotRequired": "サインインには GitHub Copilot CLI が必要です",
  "ai.copilotRequiredHint": "公式 Copilot CLI は TeXWeave のユーザーデータ内にインストールされます。Node.js 22 以降、npm、インターネット接続が必要です。システム PATH は変更しません。",
  "ai.copilotConnectTitle": "GitHub Copilot に接続", "ai.copilotConnectHint": "GitHub でサインインしてください。プロジェクトのテキストは読み取り専用のコンテキストとして共有され、このモードではファイルを編集しません。",
  "ai.chatReady": "プロジェクトについて GitHub Copilot に質問できます。共有ファイルは読み取り専用です。変更案の作成とレビューには Codex を使用してください。",
  "settings.aiPrivacyHint": "Copilot Chat は読み取り専用のプロジェクトコンテキストを受け取り、Codex は差分レビュー用の変更案を作成できます。"
});
Object.assign(catalogs["zh-TW"], {
  "ai.copilot": "Copilot", "ai.copilotAccount": "GitHub Copilot 帳戶",
  "ai.installCopilot": "為 TeXWeave 安裝 GitHub Copilot CLI", "ai.installingCopilot": "正在安裝 GitHub Copilot CLI…",
  "ai.signInGitHub": "使用 GitHub Copilot 登入", "ai.copilotRequired": "登入需要 GitHub Copilot CLI",
  "ai.copilotRequiredHint": "官方 Copilot CLI 會安裝在 TeXWeave 使用者資料目錄。需要 Node.js 22 以上版本、npm 和網際網路連線；不會變更系統 PATH。",
  "ai.copilotConnectTitle": "連線至 GitHub Copilot", "ai.copilotConnectHint": "使用 GitHub 登入以啟用 Copilot Chat。專案文字僅作為唯讀內容；此模式不會修改檔案。",
  "ai.chatReady": "向 GitHub Copilot 詢問目前專案。共享的專案檔案僅供讀取；如需提出並審閱修改，請使用 Codex。",
  "settings.aiPrivacyHint": "Copilot Chat 僅接收唯讀專案內容；Codex 可提出修改以供差異審閱。"
});
Object.assign(catalogs.ko, {
  "ai.copilot": "Copilot", "ai.copilotAccount": "GitHub Copilot 계정",
  "ai.installCopilot": "TeXWeave용 GitHub Copilot CLI 설치", "ai.installingCopilot": "GitHub Copilot CLI 설치 중…",
  "ai.signInGitHub": "GitHub Copilot으로 로그인", "ai.copilotRequired": "로그인하려면 GitHub Copilot CLI가 필요합니다",
  "ai.copilotRequiredHint": "공식 Copilot CLI가 TeXWeave 사용자 데이터 폴더에 설치됩니다. Node.js 22 이상, npm 및 인터넷 연결이 필요하며 시스템 PATH는 변경하지 않습니다.",
  "ai.copilotConnectTitle": "GitHub Copilot 연결", "ai.copilotConnectHint": "GitHub에 로그인하여 Copilot Chat을 사용하세요. 프로젝트 텍스트는 읽기 전용 컨텍스트로 공유되며 이 모드에서는 파일을 수정하지 않습니다.",
  "ai.chatReady": "GitHub Copilot에 프로젝트에 관해 질문하세요. 공유 파일은 읽기 전용입니다. 변경 제안 및 검토에는 Codex를 사용하세요.",
  "settings.aiPrivacyHint": "Copilot Chat은 읽기 전용 프로젝트 컨텍스트를 받고, Codex는 diff 검토용 변경 사항을 제안할 수 있습니다."
});
Object.assign(catalogs.fr, {
  "ai.copilot": "Copilot", "ai.copilotAccount": "Compte GitHub Copilot",
  "ai.installCopilot": "Installer GitHub Copilot CLI pour TeXWeave", "ai.installingCopilot": "Installation de GitHub Copilot CLI…",
  "ai.signInGitHub": "Se connecter avec GitHub Copilot", "ai.copilotRequired": "GitHub Copilot CLI est requis pour se connecter",
  "ai.copilotRequiredHint": "La CLI officielle Copilot sera installée dans les données utilisateur de TeXWeave. Node.js 22+, npm et une connexion Internet sont nécessaires ; le PATH système ne sera pas modifié.",
  "ai.copilotConnectTitle": "Connecter GitHub Copilot", "ai.copilotConnectHint": "Connectez-vous avec GitHub. Le texte du projet est partagé en lecture seule ; ce mode ne modifie pas les fichiers.",
  "ai.chatReady": "Posez une question sur ce projet à GitHub Copilot. Les fichiers partagés sont en lecture seule ; utilisez Codex pour proposer et examiner des modifications.",
  "settings.aiPrivacyHint": "Copilot Chat reçoit le contexte du projet en lecture seule ; Codex peut proposer des modifications à examiner en diff."
});
Object.assign(catalogs["zh-CN"], {
  "settings.aiChangeReview": "\u5ba1\u67e5\u548c\u64a4\u9500\u4fee\u6539",
  "settings.aiChangeReviewDetails": "AI \u4fee\u6539\u4f1a\u4ee5\u6e90\u7801\u5dee\u5f02\u663e\u793a\u3002\u53ef\u9010\u6761\u6216\u6279\u91cf\u5ba1\u67e5\u5e76\u5e94\u7528\uff0c\u5e94\u7528\u540e\u4e5f\u53ef\u4ee5\u64a4\u9500\u3002",
  "ai.permissionsActive": "\u9879\u76ee\u6743\u9650",
  "ai.readProject": "\u5141\u8bb8\u8bfb\u53d6\u9879\u76ee\u6587\u4ef6",
  "ai.readProjectHint": "\u672c\u6b21\u4f1a\u5411 Codex \u63d0\u4f9b\u652f\u6301\u7684 TeX/\u6587\u672c\u6587\u4ef6\u548c\u672a\u4fdd\u5b58\u7684\u7f16\u8f91\u5668\u5185\u5bb9\u3002",
  "ai.continueWithPermissions": "\u6309\u8fd9\u4e9b\u6743\u9650\u7ee7\u7eed",
  "ai.projectNotShared": "\u5c1a\u672a\u5411 Codex \u63d0\u4f9b\u9879\u76ee\u6587\u4ef6\u3002\u5f00\u542f\u4e0a\u65b9\u7684\u8bfb\u53d6\u6743\u9650\u540e\uff0c\u624d\u4f1a\u5305\u542b\u9879\u76ee\u5185\u5bb9\u3002",
  "settings.ai": "AI 助手", "settings.aiPrivacyHint": "选择默认 AI 交互模式。Chat 和 Codex 均可读取当前项目文件并提出修改。",
  "settings.aiDefaultMode": "默认 AI 模式", "settings.aiIncludeCurrentFile": "聊天默认包含当前文件", "settings.aiPermissions": "权限保护",
  "settings.aiPermissionDetails": "AI 仅在 TeXWeave 管理的项目快照中工作。需要提升权限的请求会被拒绝；修改须经审阅后才会应用。",
  "ai.recentChats": "最近的对话", "ai.newChat": "新建对话", "ai.settings": "AI 设置", "ai.clearCurrentChat": "删除当前对话",
  "ai.confirmClearChat": "确定删除此对话及其本地 AI 修改记录吗？", "ai.confirmProjectScope": "请先确认当前项目范围，再启动 Codex。",
  "ai.codexScopeTitle": "Codex 将在此项目快照中工作", "ai.codexScopeBody": "支持的文本文件和已打开的编辑器缓冲区会复制到 TeXWeave 的私有 AI 工作区；建议修改需经审阅后应用。",
  "ai.codexScopeSafety": "AI 进程无法直接写入原项目目录。", "ai.continue": "继续", "ai.you": "你", "ai.assistant": "助手", "ai.thinking": "正在思考…",
  "ai.chatReady": "可以直接询问项目问题或请求 AI 修改项目。AI 可以读取相关项目文件。", "ai.codexReady": "说明你希望对项目做什么修改，Codex 可以检查项目并编辑工作区。",
  "ai.includeSelection": "包含当前选区", "ai.includeCurrentFile": "包含当前文件（最多 80 KB）",
  "ai.messagePlaceholder": "发送消息给 TeXWeave AI…（Enter 发送）", "ai.send": "发送", "ai.stop": "停止",
  "ai.proposedChanges": "建议修改（{{count}} 个文件）", "ai.applyAccepted": "应用已接受的修改", "ai.accept": "接受", "ai.reject": "拒绝", "ai.rejectAll": "全部拒绝",
  "ai.acceptOneChange": "请先接受至少一项修改。", "ai.changesApplied": "已将接受的修改应用到编辑器缓冲区；按 Ctrl+S 保存到磁盘。", "ai.undoChanges": "撤销",
  "ai.undoConflict": "{{path}} 在应用 AI 修改后又发生变化，因此未修改该文件。", "ai.undoNoLongerAvailable": "这项 AI 修改不是最近一次应用的内容，无法安全撤销。",
  "ai.confirmDeleteFile": "要从项目中删除 {{path}} 吗？此操作会立即执行。",
  "ai.bufferConflict": "{{path}} 在 AI 生成修改期间发生变化，因此未应用建议。", "ai.hunkConflict": "无法在 {{path}} 中安全匹配此项修改，因此未应用任何内容。"
});
Object.assign(catalogs["zh-CN"], {
  "ai.permissionsActive": "项目权限",
  "ai.readProject": "允许读取项目文件",
  "ai.readProjectHint": "本次向 AI 提供支持的 TeX／文本文件及尚未保存的编辑器内容。",
  "ai.allowEdits": "允许提出修改",
  "ai.allowEditsHint": "修改仅保存在隔离副本中，应用前需要你审阅。",
  "ai.continueWithPermissions": "按这些权限继续",
  "ai.projectNotShared": "尚未向 Codex 提供项目文件。开启上方的读取权限后，才会包含项目内容。"
});
Object.assign(catalogs["zh-CN"], {
  "ai.codexScopeBody": "\u8bf7\u5728\u4e0b\u65b9\u9009\u62e9\u662f\u5426\u5141\u8bb8 Codex \u8bfb\u53d6\u9879\u76ee\u6587\u672c\u548c\u672a\u4fdd\u5b58\u7684\u7f16\u8f91\u5668\u5185\u5bb9\uff0c\u4ee5\u53ca\u662f\u5426\u5141\u8bb8\u5b83\u5728\u9694\u79bb\u526f\u672c\u4e2d\u63d0\u51fa\u4fee\u6539\u3002",
  "ai.allowEdits": "\u5141\u8bb8\u63d0\u51fa\u4fee\u6539\uff08\u9ed8\u8ba4\u5f00\u542f\uff09",
  "ai.allowEditsHint": "Codex \u5728\u9694\u79bb\u526f\u672c\u4e2d\u7f16\u8f91\uff1b\u8bf7\u67e5\u770b\u5dee\u5f02\u5e76\u6279\u51c6\u540e\uff0c\u624d\u4f1a\u5e94\u7528\u5230\u9879\u76ee\u3002",
  "ai.inlineDiffTitle": "AI \u4fee\u6539\u5efa\u8bae\u2014\u8bf7\u5728 AI \u680f\u4e2d\u5ba1\u9605",
  "ai.acceptAll": "\u5168\u90e8\u63a5\u53d7"
});
Object.assign(catalogs["zh-CN"], {
  "settings.aiPrivacyHint": "\u9009\u62e9\u9ed8\u8ba4 AI \u4ea4\u4e92\u65b9\u5f0f\u3002Chat \u548c Codex \u90fd\u53ef\u8bfb\u53d6\u5f53\u524d\u9879\u76ee\u6587\u4ef6\u5e76\u63d0\u51fa\u4fee\u6539\u3002",
  "settings.aiChangeReview": "\u5ba1\u67e5\u548c\u64a4\u9500\u4fee\u6539",
  "settings.aiChangeReviewDetails": "AI \u4fee\u6539\u4f1a\u4ee5\u6e90\u7801\u5dee\u5f02\u663e\u793a\u3002\u53ef\u9010\u6761\u6216\u6279\u91cf\u5ba1\u67e5\u5e76\u5e94\u7528\uff0c\u5e94\u7528\u540e\u4e5f\u53ef\u4ee5\u64a4\u9500\u3002",
  "ai.projectSnapshotNote": "\u5f53\u524d\u9879\u76ee\u7684\u6e90\u7801\u3001\u914d\u7f6e\u3001TeX/\u6587\u672c\u6587\u4ef6\u548c\u672a\u4fdd\u5b58\u7684\u7f16\u8f91\u5668\u6807\u7b7e\u9875\u5747\u53ef\u7528\u4f5c\u4e0a\u4e0b\u6587\u3002\u53ef\u5ba1\u67e5\u5dee\u5f02\u3001\u5e94\u7528\u4fee\u6539\u5e76\u968f\u65f6\u64a4\u9500\u3002",
  "ai.chatReady": "\u53ef\u4ee5\u76f4\u63a5\u8be2\u95ee\u9879\u76ee\u95ee\u9898\u6216\u8bf7 AI \u4fee\u6539\u9879\u76ee\u3002AI \u53ef\u4ee5\u8bfb\u53d6\u76f8\u5173\u9879\u76ee\u6587\u4ef6\u3002",
  "ai.codexReady": "\u8bf4\u660e\u4f60\u5e0c\u671b\u5bf9\u9879\u76ee\u505a\u4ec0\u4e48\u4fee\u6539\uff0cCodex \u53ef\u4ee5\u68c0\u67e5\u9879\u76ee\u5e76\u7f16\u8f91\u5de5\u4f5c\u533a\u3002"
});
Object.assign(catalogs["zh-CN"], {
  "ai.copilotAccount": "GitHub Copilot \u8d26\u6237",
  "ai.copilot": "Copilot",
  "ai.installCopilot": "\u4e3a TeXWeave \u5b89\u88c5 GitHub Copilot CLI",
  "ai.installingCopilot": "\u6b63\u5728\u5b89\u88c5 GitHub Copilot CLI\u2026",
  "ai.signInGitHub": "\u4f7f\u7528 GitHub Copilot \u767b\u5f55",
  "ai.copilotRequired": "\u767b\u5f55\u9700\u8981 GitHub Copilot CLI",
  "ai.copilotRequiredHint": "\u5b98\u65b9 Copilot CLI \u5c06\u5b89\u88c5\u5728 TeXWeave \u7528\u6237\u6570\u636e\u76ee\u5f55\uff0c\u7136\u540e\u4f7f\u7528 GitHub \u8d26\u6237\u767b\u5f55\uff1b\u4e0d\u4f1a\u4fee\u6539\u7cfb\u7edf PATH\u3002",
  "ai.copilotConnectTitle": "\u8fde\u63a5 GitHub Copilot",
  "ai.copilotConnectHint": "\u4f7f\u7528 GitHub \u767b\u5f55\u4ee5\u542f\u7528 Copilot Chat\u3002\u9879\u76ee\u6587\u672c\u4ec5\u4f5c\u4e3a\u53ea\u8bfb\u4e0a\u4e0b\u6587\uff1b\u6b64\u6a21\u5f0f\u4e0d\u4f1a\u4fee\u6539\u6587\u4ef6\u3002",
  "ai.chat": "Copilot",
  "ai.chatReady": "\u5411 GitHub Copilot \u8be2\u95ee\u5f53\u524d\u9879\u76ee\u3002\u5171\u4eab\u7684\u9879\u76ee\u6587\u4ef6\u4ec5\u4f5c\u4e3a\u53ea\u8bfb\u4e0a\u4e0b\u6587\uff1b\u5982\u9700\u63d0\u51fa\u5e76\u5ba1\u9605\u4fee\u6539\uff0c\u8bf7\u4f7f\u7528 Codex\u3002",
  "settings.aiPrivacyHint": "\u9009\u62e9\u9ed8\u8ba4 AI \u4ea4\u4e92\u65b9\u5f0f\u3002Copilot Chat \u4ec5\u63a5\u6536\u53ea\u8bfb\u9879\u76ee\u4e0a\u4e0b\u6587\uff1bCodex \u53ef\u63d0\u51fa\u4fee\u6539\u4f9b\u5dee\u5f02\u5ba1\u9605\u3002"
});
Object.assign(catalogs["zh-CN"], {
  "ai.copilotConnectHint": "\u4f7f\u7528 GitHub \u767b\u5f55\u4ee5\u542f\u7528 Copilot Chat\u3002Copilot \u53ef\u4ee5\u5728\u9879\u76ee\u5feb\u7167\u4e2d\u7f16\u8f91\uff1bTeXWeave \u4f1a\u5728\u5c06\u4fee\u6539\u5e94\u7528\u5230\u9879\u76ee\u4e4b\u524d\u663e\u793a\u5dee\u5f02\u4f9b\u5ba1\u9605\u3002",
  "ai.chatReady": "\u5411 GitHub Copilot \u8be2\u95ee\u5f53\u524d\u9879\u76ee\u6216\u8bf7\u6c42\u4fee\u6539\u3002Copilot \u5728\u9879\u76ee\u5feb\u7167\u4e2d\u5de5\u4f5c\uff0cTeXWeave \u4f1a\u5148\u663e\u793a\u5dee\u5f02\u4f9b\u5ba1\u9605\u518d\u5e94\u7528\u3002",
  "settings.aiPrivacyHint": "\u9009\u62e9\u9ed8\u8ba4 AI \u6a21\u5f0f\u3002Copilot Chat \u548c Codex \u5747\u5728\u9879\u76ee\u5feb\u7167\u4e2d\u5de5\u4f5c\uff1b\u5c06\u4fee\u6539\u5e94\u7528\u5230\u539f\u9879\u76ee\u524d\uff0c\u8bf7\u5148\u5ba1\u9605\u5dee\u5f02\u3002"
});
Object.assign(catalogs.ja, {
  "ai.copilotConnectHint": "GitHub \u3067\u30b5\u30a4\u30f3\u30a4\u30f3\u3057\u3066 Copilot Chat \u3092\u4f7f\u7528\u3057\u307e\u3059\u3002Copilot \u306f\u30d7\u30ed\u30b8\u30a7\u30af\u30c8\u306e\u30b9\u30ca\u30c3\u30d7\u30b7\u30e7\u30c3\u30c8\u5185\u3067\u7de8\u96c6\u3057\u3001\u5909\u66f4\u306f\u9069\u7528\u524d\u306b\u5dee\u5206\u3068\u3057\u3066\u78ba\u8a8d\u3067\u304d\u307e\u3059\u3002",
  "ai.chatReady": "GitHub Copilot \u306b\u8cea\u554f\u3057\u305f\u308a\u3001\u7de8\u96c6\u3092\u4f9d\u983c\u3057\u305f\u308a\u3067\u304d\u307e\u3059\u3002Copilot \u306f\u30b9\u30ca\u30c3\u30d7\u30b7\u30e7\u30c3\u30c8\u5185\u3067\u4f5c\u696d\u3057\u3001\u9069\u7528\u524d\u306b\u5dee\u5206\u3092\u78ba\u8a8d\u3067\u304d\u307e\u3059\u3002",
  "settings.aiPrivacyHint": "Copilot Chat \u3068 Codex \u306f\u30d7\u30ed\u30b8\u30a7\u30af\u30c8\u306e\u30b9\u30ca\u30c3\u30d7\u30b7\u30e7\u30c3\u30c8\u5185\u3067\u4f5c\u696d\u3057\u307e\u3059\u3002\u5143\u306e\u30d7\u30ed\u30b8\u30a7\u30af\u30c8\u306b\u9069\u7528\u3059\u308b\u524d\u306b\u5dee\u5206\u3092\u78ba\u8a8d\u3057\u3066\u304f\u3060\u3055\u3044\u3002"
});
Object.assign(catalogs["zh-TW"], {
  "ai.copilotConnectHint": "\u4f7f\u7528 GitHub \u767b\u5165\u4ee5\u555f\u7528 Copilot Chat\u3002Copilot \u6703\u5728\u5c08\u6848\u5feb\u7167\u4e2d\u7de8\u8f2f\uff1bTeXWeave \u6703\u5728\u5c07\u8b8a\u66f4\u5957\u7528\u5230\u5c08\u6848\u524d\u986f\u793a\u5dee\u7570\u4f9b\u5be9\u95b1\u3002",
  "ai.chatReady": "\u53ef\u5411 GitHub Copilot \u8a62\u554f\u76ee\u524d\u5c08\u6848\u6216\u8acb\u6c42\u7de8\u8f2f\u3002Copilot \u6703\u5728\u5c08\u6848\u5feb\u7167\u4e2d\u5de5\u4f5c\uff0cTeXWeave \u6703\u5148\u986f\u793a\u5dee\u7570\u4f9b\u5be9\u95b1\u518d\u5957\u7528\u3002",
  "settings.aiPrivacyHint": "Copilot Chat \u548c Codex \u90fd\u5728\u5c08\u6848\u5feb\u7167\u4e2d\u5de5\u4f5c\uff1b\u5957\u7528\u81f3\u539f\u59cb\u5c08\u6848\u524d\uff0c\u8acb\u5148\u5be9\u95b1\u5dee\u7570\u3002"
});
Object.assign(catalogs.ko, {
  "ai.copilotConnectHint": "GitHub\uc5d0 \ub85c\uadf8\uc778\ud558\uc5ec Copilot Chat\uc744 \uc0ac\uc6a9\ud558\uc138\uc694. Copilot\uc740 \ud504\ub85c\uc81d\ud2b8 \uc2a4\ub0c5\uc0f7\uc5d0\uc11c \uc218\uc815\ud558\uba70, \uc801\uc6a9 \uc804\uc5d0 \ubcc0\uacbd \uc0ac\ud56d\uc744 diff\ub85c \ud655\uc778\ud560 \uc218 \uc788\uc2b5\ub2c8\ub2e4.",
  "ai.chatReady": "GitHub Copilot\uc5d0\uac8c \ud504\ub85c\uc81d\ud2b8\uc5d0 \ub300\ud574 \ubb3b\uac70\ub098 \uc218\uc815\uc744 \uc694\uccad\ud558\uc138\uc694. Copilot\uc740 \uc2a4\ub0c5\uc0f7\uc5d0\uc11c \uc791\uc5c5\ud558\uba70 \uc801\uc6a9 \uc804\uc5d0 diff\ub97c \ud655\uc778\ud560 \uc218 \uc788\uc2b5\ub2c8\ub2e4.",
  "settings.aiPrivacyHint": "Copilot Chat\uacfc Codex\ub294 \ud504\ub85c\uc81d\ud2b8 \uc2a4\ub0c5\uc0f7\uc5d0\uc11c \uc791\uc5c5\ud569\ub2c8\ub2e4. \uc6d0\ubcf8 \ud504\ub85c\uc81d\ud2b8\uc5d0 \uc801\uc6a9\ud558\uae30 \uc804\uc5d0 diff\ub97c \uac80\ud1a0\ud558\uc138\uc694."
});
Object.assign(catalogs.fr, {
  "ai.copilotConnectHint": "Connectez-vous avec GitHub. Copilot modifie un instantané du projet ; TeXWeave affiche les changements pour examen avant leur application au projet.",
  "ai.chatReady": "Interrogez GitHub Copilot sur ce projet ou demandez une modification. Copilot travaille sur un instantané et TeXWeave affiche le diff avant toute application.",
  "settings.aiPrivacyHint": "Copilot Chat et Codex travaillent sur des instantanés du projet ; examinez leurs diffs avant d’appliquer les changements au projet original."
});
const shortcutManagerMessages: Partial<Record<Locale, Record<string, string>>> = {
  en: {
    "shortcut.search": "Search commands, shortcuts, groups, or contexts…", "shortcut.filter": "Filter commands",
    "shortcut.filter.all": "All commands", "shortcut.filter.modified": "Modified", "shortcut.filter.conflicts": "Conflicts", "shortcut.filter.unassigned": "Unassigned", "shortcut.filter.userDefined": "User-defined", "shortcut.filter.default": "Default",
    "shortcut.view.commands": "Commands", "shortcut.view.map": "Keyboard map", "shortcut.view.conflicts": "Conflicts", "shortcut.projectHint": "Project shortcuts override global shortcuts; clearing a project shortcut restores the global binding.",
    "shortcut.command": "Command", "shortcut.group": "Group", "shortcut.context": "Context", "shortcut.binding": "Shortcut", "shortcut.unassigned": "Unassigned", "shortcut.changeBinding": "Change shortcut", "shortcut.resetBinding": "Reset shortcut", "shortcut.noCommands": "No commands match this filter.", "shortcut.noKeys": "No keys match this view.",
    "shortcut.description.edit.undo": "Undo the most recent change.", "shortcut.description.edit.redo": "Restore the most recently undone change.", "shortcut.description.file.save": "Save the active document.", "shortcut.description.file.saveAll": "Save every open document.", "shortcut.description.edit.find": "Search within the source editor.", "shortcut.description.edit.replace": "Find and replace source text.", "shortcut.description.navigation.back": "Return to the previous document location.", "shortcut.description.navigation.forward": "Move forward through document locations.", "shortcut.description.latex.compile": "Compile the current project.", "shortcut.description.settings.open": "Open application settings.", "shortcut.description.ai.open": "Open the AI assistant.", "shortcut.description.block.insertBefore": "Insert a block before the selected Preview block.", "shortcut.description.block.insertAfter": "Insert a block after the selected Preview block.", "shortcut.description.block.createFromSelection": "Create a semantic block from selected source text.", "shortcut.description.preview.applyDraft": "Apply the current Preview source edit.", "shortcut.description.preview.cancelDraft": "Discard the current Preview source edit.",
    "shortcut.group.general": "General", "shortcut.group.navigation": "Navigation", "shortcut.group.editing": "Editing", "shortcut.group.blocks": "Blocks", "shortcut.group.search": "Search", "shortcut.group.build": "Build", "shortcut.group.files": "Files", "shortcut.group.ai": "AI",
    "shortcut.modifier": "Modifier", "shortcut.modifier.none": "No modifier", "shortcut.modifier.Mod": "Ctrl / Command", "shortcut.modifier.Ctrl": "Control", "shortcut.modifier.Shift": "Shift", "shortcut.modifier.Alt": "Alt / Option", "shortcut.modifier.Mod.Shift": "Ctrl / Command + Shift", "shortcut.modifier.Mod.Alt": "Ctrl / Command + Alt / Option", "shortcut.modifier.Alt.Shift": "Alt / Option + Shift", "shortcut.modifier.Ctrl.Shift": "Control + Shift", "shortcut.modifier.Ctrl.Alt": "Control + Alt",
    "shortcut.context.all": "All contexts", "shortcut.testKeys": "Test keys", "shortcut.stopTest": "Stop testing", "shortcut.pressToTest": "Press a key to test it", "shortcut.availableKeys": "Available keys", "shortcut.selectContext": "Select a context before testing keys.", "shortcut.showKeys": "Show keys", "shortcut.mapFilter.all": "All", "shortcut.mapFilter.assigned": "Assigned", "shortcut.mapFilter.available": "Available", "shortcut.mapFilter.conflicts": "Conflicts",
    "shortcut.mapFilter.group": "Function group", "shortcut.mapFilter.allGroups": "All groups", "shortcut.mapFilter.name": "Function", "shortcut.mapFilter.namePlaceholder": "Search by name or description", "shortcut.mapFilter.key": "Key", "shortcut.mapFilter.keyPlaceholder": "Search a shortcut, e.g. Ctrl+S", "shortcut.mapFilter.state.all": "All functions", "shortcut.mapFilter.state.conflicts": "Conflicts", "shortcut.mapFilter.state.reserved": "System-reserved", "shortcut.mapFilter.state.clear": "No binding issues", "shortcut.mapFilter.state.assigned": "Assigned", "shortcut.mapFilter.state.unassigned": "Unassigned", "shortcut.mapFilter.bindingStatus": "Binding status", "shortcut.mapFilter.functions": "Functions", "shortcut.mapFilter.functionCount": "{{count}} functions", "shortcut.mapFilter.pickFunction": "Select a function in the list, then press the replacement keys while watching the keyboard map below.", "shortcut.mapFilter.pressReplacement": "Press the new shortcut",
    "shortcut.testCommand": "Command", "shortcut.source": "Source", "shortcut.source.default": "Default", "shortcut.source.user": "User", "shortcut.source.project": "Project", "shortcut.shadowed": "Shadowed", "shortcut.chordPending": "Chord prefix", "shortcut.testUnassigned": "Unassigned in this context",
    "shortcut.context.workspace": "Workspace", "shortcut.context.editor": "Editor", "shortcut.context.preview": "Preview", "shortcut.context.relation": "Relations", "shortcut.context.fileTree": "File tree", "shortcut.context.search": "Search", "shortcut.context.dialog": "Dialog", "shortcut.context.shortcutManager": "Shortcut manager",
    "shortcut.keyStatus.unused": "Unused", "shortcut.keyStatus.assigned": "Assigned", "shortcut.keyStatus.multiple": "Multiple contexts", "shortcut.keyStatus.conflict": "Conflict", "shortcut.keyStatus.prefix": "Chord prefix", "shortcut.keyStatus.reserved": "OS reserved",
    "shortcut.conflictType.direct": "Direct conflict", "shortcut.conflictType.overlap": "Context overlap", "shortcut.conflictType.prefix": "Chord prefix", "shortcut.noConflicts": "No shortcut conflicts found.", "shortcut.osReservedHint": "This shortcut may be intercepted by the operating system.",
    "shortcut.recordTitle": "Record shortcut", "shortcut.recordSecond": "Press the second key…", "shortcut.directConflict": "This shortcut is already assigned in the same context.", "shortcut.prefixConflict": "A shortcut cannot also be the start of a chord.", "shortcut.overlapConflict": "This shortcut is also used in a parent or child context.", "shortcut.assignAnyway": "Assign anyway", "shortcut.replaceExisting": "Replace existing shortcut", "shortcut.useBinding": "Use this shortcut", "shortcut.addSecondKey": "Add a second key", "shortcut.clearBinding": "Clear shortcut", "shortcut.invalid": "Use a supported key or modifier combination. Chords may contain up to two strokes."
  },
  "zh-CN": {
    "shortcut.search": "搜索命令、快捷键、分组或上下文…", "shortcut.filter": "筛选命令",
    "shortcut.filter.all": "全部命令", "shortcut.filter.modified": "已修改", "shortcut.filter.conflicts": "有冲突", "shortcut.filter.unassigned": "未分配", "shortcut.filter.userDefined": "自定义", "shortcut.filter.default": "默认",
    "shortcut.view.commands": "命令", "shortcut.view.map": "键位图", "shortcut.view.conflicts": "冲突", "shortcut.projectHint": "项目快捷键优先于全局快捷键；清除项目快捷键会恢复全局绑定。",
    "shortcut.command": "命令", "shortcut.group": "分组", "shortcut.context": "上下文", "shortcut.binding": "快捷键", "shortcut.unassigned": "未分配", "shortcut.changeBinding": "更改快捷键", "shortcut.resetBinding": "重置快捷键", "shortcut.noCommands": "没有符合条件的命令。", "shortcut.noKeys": "没有符合条件的按键。",
    "shortcut.description.edit.undo": "撤销最近一次更改。", "shortcut.description.edit.redo": "恢复最近一次撤销的更改。", "shortcut.description.file.save": "保存当前文档。", "shortcut.description.file.saveAll": "保存所有已打开的文档。", "shortcut.description.edit.find": "在源代码编辑器中搜索。", "shortcut.description.edit.replace": "查找并替换源代码文本。", "shortcut.description.navigation.back": "返回上一个文档位置。", "shortcut.description.navigation.forward": "前进到下一个文档位置。", "shortcut.description.latex.compile": "编译当前项目。", "shortcut.description.settings.open": "打开应用设置。", "shortcut.description.ai.open": "打开 AI 助手。", "shortcut.description.block.insertBefore": "在选中的预览块之前插入块。", "shortcut.description.block.insertAfter": "在选中的预览块之后插入块。", "shortcut.description.block.createFromSelection": "根据选中的源代码创建语义块。", "shortcut.description.preview.applyDraft": "应用当前预览源码修改。", "shortcut.description.preview.cancelDraft": "丢弃当前预览源码修改。",
    "shortcut.group.general": "常规", "shortcut.group.navigation": "导航", "shortcut.group.editing": "编辑", "shortcut.group.blocks": "块", "shortcut.group.search": "搜索", "shortcut.group.build": "构建", "shortcut.group.files": "文件", "shortcut.group.ai": "AI",
    "shortcut.modifier": "修饰键", "shortcut.modifier.none": "无修饰键", "shortcut.modifier.Mod": "Ctrl / Command", "shortcut.modifier.Ctrl": "Control", "shortcut.modifier.Shift": "Shift", "shortcut.modifier.Alt": "Alt / Option", "shortcut.modifier.Mod.Shift": "Ctrl / Command + Shift", "shortcut.modifier.Mod.Alt": "Ctrl / Command + Alt / Option", "shortcut.modifier.Alt.Shift": "Alt / Option + Shift", "shortcut.modifier.Ctrl.Shift": "Control + Shift", "shortcut.modifier.Ctrl.Alt": "Control + Alt",
    "shortcut.context.all": "全部上下文", "shortcut.testKeys": "测试按键", "shortcut.stopTest": "停止测试", "shortcut.pressToTest": "按下按键进行测试", "shortcut.availableKeys": "可用按键", "shortcut.selectContext": "请先选择上下文，再测试按键。", "shortcut.showKeys": "显示按键", "shortcut.mapFilter.all": "全部", "shortcut.mapFilter.assigned": "已分配", "shortcut.mapFilter.available": "可用", "shortcut.mapFilter.conflicts": "冲突",
    "shortcut.mapFilter.group": "功能组", "shortcut.mapFilter.allGroups": "全部功能组", "shortcut.mapFilter.name": "功能名称", "shortcut.mapFilter.namePlaceholder": "按名称或说明搜索", "shortcut.mapFilter.key": "按键", "shortcut.mapFilter.keyPlaceholder": "搜索快捷键，例如 Ctrl+S", "shortcut.mapFilter.state.all": "全部功能", "shortcut.mapFilter.state.conflicts": "快捷键冲突", "shortcut.mapFilter.state.reserved": "系统占用", "shortcut.mapFilter.state.clear": "无绑定问题", "shortcut.mapFilter.state.assigned": "已分配", "shortcut.mapFilter.state.unassigned": "未分配", "shortcut.mapFilter.bindingStatus": "绑定状态", "shortcut.mapFilter.functions": "功能列表", "shortcut.mapFilter.functionCount": "{{count}} 个功能", "shortcut.mapFilter.pickFunction": "点击列表中的功能后按下新快捷键，观察下方键盘上的实时变化。", "shortcut.mapFilter.pressReplacement": "请按下新的快捷键",
    "shortcut.testCommand": "命令", "shortcut.source": "来源", "shortcut.source.default": "默认", "shortcut.source.user": "用户", "shortcut.source.project": "项目", "shortcut.shadowed": "被覆盖", "shortcut.chordPending": "连击前缀", "shortcut.testUnassigned": "此上下文中未分配",
    "shortcut.context.workspace": "工作区", "shortcut.context.editor": "编辑器", "shortcut.context.preview": "预览", "shortcut.context.relation": "关系", "shortcut.context.fileTree": "文件树", "shortcut.context.search": "搜索", "shortcut.context.dialog": "对话框", "shortcut.context.shortcutManager": "快捷键管理器",
    "shortcut.keyStatus.unused": "未使用", "shortcut.keyStatus.assigned": "已分配", "shortcut.keyStatus.multiple": "多个上下文", "shortcut.keyStatus.conflict": "冲突", "shortcut.keyStatus.prefix": "连击前缀", "shortcut.keyStatus.reserved": "系统占用",
    "shortcut.conflictType.direct": "直接冲突", "shortcut.conflictType.overlap": "上下文重叠", "shortcut.conflictType.prefix": "连击前缀", "shortcut.noConflicts": "没有发现快捷键冲突。", "shortcut.osReservedHint": "此快捷键可能会被操作系统拦截。",
    "shortcut.recordTitle": "录制快捷键", "shortcut.recordSecond": "请按下第二个按键…", "shortcut.directConflict": "此快捷键已在相同上下文中分配。", "shortcut.prefixConflict": "一个快捷键不能同时作为连击的起始按键。", "shortcut.overlapConflict": "此快捷键也用于父级或子级上下文。", "shortcut.assignAnyway": "仍然分配", "shortcut.replaceExisting": "替换现有快捷键", "shortcut.useBinding": "使用此快捷键", "shortcut.addSecondKey": "添加第二个按键", "shortcut.clearBinding": "清除快捷键", "shortcut.invalid": "请选择支持的按键或修饰键组合。连击最多包含两段。"
  }
};
for (const [language, labels] of Object.entries(shortcutManagerMessages)) Object.assign(catalogs[language as Locale], labels);
Object.assign(catalogs.en, {
  "blockOperation.selectPrevious": "Select previous block",
  "blockOperation.selectNext": "Select next block",
  "shortcut.description.block.selectPrevious": "Select the previous visible Preview block.",
  "shortcut.description.block.selectNext": "Select the next visible Preview block.",
  "shortcut.description.block.copy": "Copy selected blocks with all nested content.",
  "shortcut.description.block.cut": "Cut selected blocks with all nested content.",
  "shortcut.description.block.paste": "Paste blocks after the selected block.",
  "shortcut.description.block.duplicate": "Duplicate selected blocks and their children.",
  "shortcut.description.block.collapse": "Collapse selected blocks in Preview without changing source.",
  "shortcut.description.block.expand": "Expand selected blocks in Preview.",
  "shortcut.description.block.disable": "Temporarily disable selected blocks in LaTeX source.",
  "shortcut.description.block.enable": "Restore selected disabled blocks in LaTeX source.",
  "shortcut.description.block.delete": "Delete selected blocks and all nested content.",
  "shortcut.description.block.removeEnvironment": "Remove only the selected LaTeX environment wrapper, keeping its contents."
});
Object.assign(catalogs["zh-CN"], {
  "blockOperation.selectPrevious": "选择上一个块",
  "blockOperation.selectNext": "选择下一个块",
  "shortcut.description.block.selectPrevious": "选择预览中上一个可见块。",
  "shortcut.description.block.selectNext": "选择预览中下一个可见块。",
  "shortcut.description.block.copy": "复制选中块及其全部子块。",
  "shortcut.description.block.cut": "剪切选中块及其全部子块。",
  "shortcut.description.block.paste": "在选中块之后粘贴块。",
  "shortcut.description.block.duplicate": "复制一份选中块及其全部子块。",
  "shortcut.description.block.collapse": "仅在预览中收起选中块，不修改源码。",
  "shortcut.description.block.expand": "在预览中展开选中块。",
  "shortcut.description.block.disable": "在 LaTeX 源码中暂时关闭选中块。",
  "shortcut.description.block.enable": "在 LaTeX 源码中恢复选中的已关闭块。",
  "shortcut.description.block.delete": "删除选中块及其全部子块。",
  "shortcut.description.block.removeEnvironment": "只移除选中块的 LaTeX 环境外壳，保留内部内容。"
});
Object.assign(catalogs.en, {
  "shortcut.holdModifiers": "Focus here and hold modifier keys to preview",
  "shortcut.modifierHeld": "Held now",
  "shortcut.clickModifierKey": "You can also click Ctrl, Shift, Alt, or Command on the keyboard.",
  "shortcut.nativeCategory": "Built-in",
  "shortcut.appCategory": "TeXWeave",
  "shortcut.native.selectAll": "Select all",
  "shortcut.native.copy": "Copy",
  "shortcut.native.cut": "Cut",
  "shortcut.native.paste": "Paste",
  "shortcut.native.quit": "Quit application",
  "shortcut.native.switchApps": "Switch applications",
  "shortcut.native.systemSearch": "Open system search",
  "shortcut.native.lockScreen": "Lock screen",
  "shortcut.native.closeWindow": "Close window",
  "shortcut.native.openStart": "Open Start menu",
  "shortcut.native.taskManager": "Open Task Manager",
  "shortcut.native.taskView": "Open Task View",
  "shortcut.native.inputLanguage": "Switch input language",
  "shortcut.native.securityOptions": "Open security options",
  "shortcut.native.copyAlternate": "Copy (alternate)",
  "shortcut.native.pasteAlternate": "Paste (alternate)",
  "shortcut.native.cutAlternate": "Cut text / delete file",
  "shortcut.keyStatus.native": "System / editor built-in",
  "shortcut.nativeOverrideWarning": "Assigning an app shortcut here may take precedence over the built-in action.",
  "shortcut.mapEdit.title": "Edit key binding",
  "shortcut.mapEdit.close": "Close key editor",
  "shortcut.mapEdit.currentOwners": "Commands using this key",
  "shortcut.mapEdit.rebind": "Record a different shortcut",
  "shortcut.mapEdit.chooseCommand": "Assign an app command to this key",
  "shortcut.mapEdit.none": "Choose a command…",
  "shortcut.mapEdit.assign": "Assign this key",
  "shortcut.mapEdit.hint": "Choose a command to use this key, or record a different shortcut for a command already listed.",
});
Object.assign(catalogs["zh-CN"], {
  "shortcut.holdModifiers": "聚焦此处并按住修饰键，即可预览组合",
  "shortcut.modifierHeld": "正在按住",
  "shortcut.clickModifierKey": "也可以点击键盘上的 Ctrl、Shift、Alt 或 Command 键进行切换。",
  "shortcut.nativeCategory": "系统/编辑器内置",
  "shortcut.appCategory": "应用快捷键",
  "shortcut.native.selectAll": "全选",
  "shortcut.native.copy": "复制",
  "shortcut.native.cut": "剪切",
  "shortcut.native.paste": "粘贴",
  "shortcut.native.quit": "退出应用",
  "shortcut.native.switchApps": "切换应用",
  "shortcut.native.systemSearch": "打开系统搜索",
  "shortcut.native.lockScreen": "锁定屏幕",
  "shortcut.native.closeWindow": "关闭窗口",
  "shortcut.native.openStart": "打开开始菜单",
  "shortcut.native.taskManager": "打开任务管理器",
  "shortcut.native.taskView": "打开任务视图",
  "shortcut.native.inputLanguage": "切换输入语言",
  "shortcut.native.securityOptions": "打开安全选项",
  "shortcut.native.copyAlternate": "复制（备用组合）",
  "shortcut.native.pasteAlternate": "粘贴（备用组合）",
  "shortcut.native.cutAlternate": "剪切文本/删除文件",
  "shortcut.keyStatus.native": "系统/编辑器内置",
  "shortcut.nativeOverrideWarning": "在此组合键分配应用命令后，可能会优先触发应用操作，而不执行内置功能。",
  "shortcut.mapEdit.title": "编辑键位绑定",
  "shortcut.mapEdit.close": "关闭键位编辑",
  "shortcut.mapEdit.currentOwners": "当前使用此组合键的命令",
  "shortcut.mapEdit.rebind": "录制新的快捷键",
  "shortcut.mapEdit.chooseCommand": "将应用命令绑定到此组合键",
  "shortcut.mapEdit.none": "选择命令…",
  "shortcut.mapEdit.assign": "绑定此组合键",
  "shortcut.mapEdit.hint": "选择命令即可使用此组合键；也可以为当前命令录制其他快捷键。",
});

let locale: Locale = "en";
export function setLocale(value: Locale): void { locale = value in catalogs ? value : "en"; }

export function t(key: string, variables?: Record<string, string | number>): string {
  let value = key === "app.version" ? `v${__APP_VERSION__}` : catalogs[locale][key] ?? catalogs.en[key] ?? key;
  for (const [name, replacement] of Object.entries(variables ?? {})) {
    value = value.replaceAll(`{{${name}}}`, String(replacement));
  }
  return value;
}

export type { MessageKey };
