const code = `                <div key={msg._uiId} className={\`bubbleRow \${msg.fromMe ? "mine" : "theirs"} \${isConsecutive ? "consecutive" : ""} \${msg.isRevoked ? "revokedRow" : ""}\`}>
                  <article
                    className={\`bubble \${
                      !msg.fromMe && grammarInsights[msg._uiId]?.hasErrors ? "incomingGrammarError" : ""
                    } \${msg.isRevoked ? "isRevoked" : ""}\`}
                    tabIndex={!msg.fromMe && grammarInsights[msg._uiId]?.hasErrors ? 0 : undefined}
                    role={!msg.fromMe && grammarInsights[msg._uiId]?.hasErrors ? "button" : undefined}
                    aria-label={!msg.fromMe && grammarInsights[msg._uiId]?.hasErrors ? "Mensaje con errores gramaticales, clic para corregir" : undefined}
                    onClick={
                      !msg.fromMe && grammarInsights[msg._uiId]?.hasErrors
                        ? () => prepareGrammarReply(msg)
                        : undefined
                    }`;
console.log(code);
