# RFC 0001: Core LLM API

Status: Draft

## Summary

This RFC documents the current `libs/core` LLM API as implemented in
`libs/core/src/types.ts` and `libs/core/src/providers.ts`.

The core package defines:

- a provider-agnostic transcript format built from `Message` and `ChatItem`
- a minimal `Provider` interface for one-shot generation
- a transport adapter that maps the internal transcript model to an
  OpenAI-compatible chat completions payload
- a first concrete provider, `DeepSeekProvider`

The intent of this RFC is to make the existing contract explicit before the
surface area grows.

## Goals

- Define the stable in-process API exposed by `libs/core`
- Describe the semantics of each transcript item type
- Document how the internal model maps to chat completions requests and
  responses
- Record the behavior and limitations of the current DeepSeek-backed provider

## Non-Goals

- Streaming responses
- Multi-modal inputs or outputs
- System or developer roles
- Automatic tool execution
- Provider-independent finish reasons
- Full response metadata normalization

## API Surface

The current public surface is:

```ts
export type ChatItem =
  | { type: 'reasoning'; content: string; encrypted?: string }
  | { type: 'input-text'; content: string }
  | { type: 'output-text'; content: string }
  | { type: 'tool-call'; id: string; name: string; arguments: string }
  | { type: 'tool-result'; id: string; content: string }

export interface Message {
  items: ChatItem[]
}

export interface Response {
  message: Message
  token_usage?: TokenUsage
}

export interface TokenUsage {
  input_tokens: number
  output_tokens: number
}

export interface Config {
  model: string
  base_url: string
  api_key: string
  thinking: boolean
}

export interface Provider {
  generate(
    messages: Message[],
    config: Config,
    tools?: Tool[]
  ): Promise<Response>
}

export interface Tool {
  name: string
  description: string
  parameters: object
}
```

`FinishReason = 'stop' | 'length' | 'tool-call' | 'error'` also exists in the
type layer, but it is not currently used by `Response` or any provider
implementation.

## Transcript Model

### Message

`Message` is an ordered list of `ChatItem`s. A message does not carry an
explicit role. Instead, role-like meaning is derived from the item types inside
it.

In practice, a transcript is represented as `Message[]`, where each element is
one user turn, assistant turn, or tool result bundle.

### ChatItem

#### `reasoning`

Represents assistant reasoning text.

- `content` stores plain reasoning text
- `encrypted` exists in the type but is not currently consumed by the provider
  adapter

#### `input-text`

Represents user-authored text input.

#### `output-text`

Represents assistant-authored text output.

#### `tool-call`

Represents an assistant request to invoke a tool.

- `id` is the provider-generated tool call id
- `name` is the tool/function name
- `arguments` is a JSON string payload

#### `tool-result`

Represents the result of a previously issued tool call.

- `id` must match the original tool call id
- `content` is the serialized tool output

## Provider Contract

`Provider.generate(messages, config, tools?)` is a one-shot call that accepts
the full conversation history and returns one `Response`.

Current expectations:

- `messages` is the full ordered transcript to send upstream
- `config` contains model selection, base URL, credentials, and whether
  reasoning mode should be enabled
- `tools` is reserved in the interface, but the current provider implementation
  does not send tool definitions to the backend
- the returned `Response` always contains a single assistant `message`
- `token_usage` is optional and is not currently populated by
  `DeepSeekProvider`

## Chat Completions Mapping

`libs/core/src/providers.ts` defines an internal adapter between `Message[]` and
an OpenAI-style chat completions schema.

### Request Shape

The request model is:

```ts
interface OpenAIChatCompletionsRequest {
  model: string
  messages: OpenAIChatCompletionMessage[]
  thinking?: { type: 'enabled' }
}
```

The message union is:

```ts
type OpenAIChatCompletionMessage =
  | { role: 'user'; content: string }
  | {
      role: 'assistant'
      content?: string
      reasoning_content?: string
      tool_calls?: OpenAIChatCompletionToolCall[]
    }
  | { role: 'tool'; content: string; tool_call_id: string }
```

Although these types are named `OpenAI*`, the shape includes DeepSeek-specific
extensions:

- `thinking`
- `reasoning_content`

### Internal to Wire Conversion

`toChatCompletions(messages, config)` converts the internal transcript into a
wire request.

Conversion rules:

1. `input-text` becomes a `{ role: 'user', content }` message.
2. `output-text` becomes an assistant message with `content`.
3. `reasoning` is buffered and attached to the next emitted assistant message as
   `reasoning_content`.
4. `tool-call` items are buffered and attached to the next emitted assistant
   message as `tool_calls`.
5. `tool-result` becomes `{ role: 'tool', tool_call_id, content }`.
6. Any buffered reasoning or tool calls are flushed at the end of each
   `Message`.

The flush behavior matters:

- If a `Message` contains reasoning and/or tool calls but no `output-text`,
  `toChatCompletions` still emits an assistant message with `content: ''`.
- A `tool-result` forces any pending assistant state to be emitted before the
  tool message.

This makes the `Message` boundary semantically significant.

### Wire to Internal Conversion

`fromChatCompletions(message)` currently accepts only an assistant message and
maps it back into one internal `Message`.

Conversion rules:

1. `reasoning_content` becomes a `reasoning` item.
2. Each entry in `tool_calls` becomes a `tool-call` item.
3. `content`, when present, becomes an `output-text` item.

Current limitations of the reverse mapping:

- non-assistant roles are rejected
- `encrypted` reasoning is not reconstructed
- empty string assistant content is still treated as `output-text`

## DeepSeek Provider

`DeepSeekProvider` is the only concrete provider currently implemented.

### Supported Models

The provider validates `config.model` against:

- `deepseek-chat`
- `deepseek-reasoner`

Any other model string throws `Error('unknown model: ' + config.model)`.

### Request Flow

`DeepSeekProvider.generate(...)` performs the following steps:

1. Validate the model against the allowlist.
2. Convert the internal transcript with `toChatCompletions(...)`.
3. If `config.thinking` is true, add `thinking: { type: 'enabled' }`.
4. `POST` the JSON body to `new URL('/chat/completions', config.base_url)`.
5. Send `Authorization: Bearer <api_key>` and `Content-Type: application/json`.
6. Read `json.choices[0].message`.
7. Convert that assistant message back with `fromChatCompletions(...)`.

### Error Handling

If the HTTP status is not `200`, the provider throws `Error('bad response')`.
No structured provider error is returned.

### Current Omissions

The present implementation does not yet:

- send the `tools` argument in the request
- capture or return token usage
- expose finish reason
- support streaming
- handle multiple choices
- normalize provider-specific error payloads

## Example

An example tool round trip in the internal format:

```ts
const history: Message[] = [
  {
    items: [{ type: 'input-text', content: 'What is the weather in Paris?' }],
  },
  {
    items: [
      { type: 'reasoning', content: 'Need weather lookup.' },
      {
        type: 'tool-call',
        id: 'call_1',
        name: 'get_weather',
        arguments: '{"city":"Paris"}',
      },
    ],
  },
  {
    items: [
      {
        type: 'tool-result',
        id: 'call_1',
        content: '{"temperature_c":18,"condition":"cloudy"}',
      },
    ],
  },
]
```

This is converted into:

1. a user message
2. an assistant message carrying `reasoning_content`, `tool_calls`, and empty
   `content`
3. a tool message carrying the tool result

## Design Notes

The current API is intentionally minimal:

- transcript structure is expressed with a small set of item types
- provider configuration is plain data rather than a provider-specific class
- tool calls and reasoning are preserved in the transcript instead of being
  hidden behind higher-level abstractions

That simplicity makes the current implementation easy to extend, but it also
means some fields are placeholders for future work rather than fully wired
features.

## Follow-Ups

The next likely extensions are:

- add system/developer messages or a first-class role model
- wire `Tool[]` into outbound provider requests
- return `token_usage` and finish reasons
- decide how encrypted reasoning should flow through providers
- avoid empty `output-text` items when an assistant turn only carries tool calls
  or reasoning
- define a streaming interface alongside `generate(...)`
