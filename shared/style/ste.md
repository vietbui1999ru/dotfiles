# STE writing rules (full)

These rules adapt ASD-STE100 Simplified Technical English for software docs. This file is a working summary, not the official text. The official specification is free on request from asd-ste100.org.

Applies to: READMEs, runbooks, commit bodies, code comments, step lists.
Does not apply to: analysis, trade-offs, uncertainty, code, identifiers, quoted output, marketing copy. Use the voice rules in `rules.md` there.

## Words

- Use one word for one meaning. Use one term for one concept in a document.
- Use the shortest common word that is correct: "use", not "utilize"; "start", not "initiate".
- Use technical names and technical verbs from the project as they are. Do not invent synonyms.
- Keep articles ("the", "a", "an") and demonstratives ("this", "these"). Do not write telegraphic text.
- Do not use contractions.
- Do not edit quoted errors, commands, paths, flags, or exact strings.

## Noun clusters

- Use three words maximum in a noun cluster.
- Split a longer cluster with a preposition: "the timeout of the retry queue", not "retry queue timeout value".

## Verbs

- Use simple tenses: imperative, simple present, simple past, simple future.
- Use the active voice. In descriptions, use the passive voice only when the actor is not known or not important.
- Do not use "-ing" verb forms as verbs. Technical names that end in "-ing" are permitted.
- Use a verb to show an action. Do not hide the action in a noun: "configure the proxy", not "perform the configuration of the proxy".

## Sentences

- Procedures: 20 words per sentence maximum.
- Descriptions: 25 words per sentence maximum.
- Write one topic per sentence.
- Split a long sentence. Do not drop a fact or a condition when you split it.
- Do not chain modal verbs ("should be able to", "might need to"). State uncertainty in its own plain sentence.

## Procedures

- Write one instruction per sentence. Two actions can share a sentence only when they occur at the same time.
- Put the condition before the command: "If the build fails, read the log."
- Use the imperative: "Run the tests."
- Use a numbered list when the order of steps is important.
- Give the expected result after a step when it is not obvious.

## Descriptions

- Write one topic per paragraph, with six sentences maximum.
- Put the most important information first in each paragraph.
- Use a list for items that are parallel.

## Warnings and cautions

- Start with a command or a condition: "Stop the service before you edit the file." "If the disk is full, the write fails."
- Give the risk in the next sentence. Keep the warning before the step it applies to.

## Check before you send

- Count the words in each procedural sentence.
- Confirm that no fact, condition, or caveat was lost in a split.
- Confirm that code, commands, paths, flags, and quotes are unchanged.

## Examples

- Not STE: "It is recommended that the user should consider utilizing the retry mechanism in situations where timeouts are being encountered."
- STE: "If a request times out, use the retry option."
- Not STE: "Database connection pool size configuration parameter."
- STE: "The size of the database connection pool."
- Not STE: "In order to deploy, the config should be updated and the service restarted."
- STE: "To deploy, update the configuration file. Then restart the service."
