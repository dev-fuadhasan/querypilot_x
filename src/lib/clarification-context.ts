/** Retain the unresolved question when a user answers with a short field or option. */
export function contextualizeClarification(answer:string, original:string):string {
  const cleaned=answer.trim().slice(0,260);
  const context=original.trim().slice(0,500);
  if(!cleaned||!context)return cleaned;
  return "CUSTOM CLARIFICATION: "+cleaned+"\nPRIOR REQUEST FOR CONTEXT: "+context;
}
export function shouldUseClarificationContext(answer:string):boolean {
  const text=answer.trim();
  if(!text||text.length>70||/[?]/.test(text)||/\b(?:new question|instead|start over|forget|show me|find all|give me|create)\b/i.test(text))
    return false;
  return text.split(/\s+/).length<=7;
}
