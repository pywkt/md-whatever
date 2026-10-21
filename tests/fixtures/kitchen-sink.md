---
title: Kitchen sink
tags: [test, fixture]
---

# Kitchen Sink

Every construct mdread must render. Front matter above this heading is hidden.
Jump to [the tables section](#tables) or the [footnotes](#footnotes-section).

## Inline formatting

Plain text with **bold**, *italic*, ***bold italic***, ~~strikethrough~~,
`inline code`, and a [link to example.com](https://example.com "Example title").
An autolink: https://www.kernel.org and an email: someone@example.com.
A hard line break follows  
right here. Escaped \*asterisks\* and an entity: &copy; &rarr; &#8364;.

## Headings

### Third level heading
#### Fourth level heading
##### Fifth level heading
###### Sixth level heading

## Lists

- First item
- Second item with a longer line of text that should wrap neatly onto the next line inside the column
  - Nested item
    - Deeper nested item
      - Deepest item
- Third item

1. One
2. Two
   1. Two point one
   2. Two point two
3. Three

A separate list that starts at five:

5. Five
6. Six

A loose list:

- Paragraph one in a loose list.

- Paragraph two, with a second paragraph:

  This paragraph belongs to the same item.

### Task lists

- [x] Write the plan
- [x] Build the viewer
- [ ] Render all the math
- [ ] Take a break

## Blockquotes

> A blockquote with **formatting** and `code`.
>
> > A nested blockquote.
>
> Back to the first level.

## Code

```python
def fib(n: int) -> int:
    """Return the n-th Fibonacci number."""
    a, b = 0, 1
    for _ in range(n):
        a, b = b, a + b
    return a  # comment
```

```cpp
#include <iostream>
int main() {
    std::cout << "Hello, world\n"; // greeting
    return 0;
}
```

```bash
for f in *.md; do mdread "$f" & done
```

```rust
fn main() {
    let v: Vec<u32> = (1..=10).map(|x| x * x).collect();
    println!("{:?}", v);
}
```

```json
{ "name": "mdread", "version": "0.1.0", "offline": true }
```

```nosuchlanguage
This language is unknown, so it is shown plain.
```

```
A fence with no language at all, and a very long line that goes on and on and on and on and on to check how wrapping behaves in code blocks.
```

    Indented code block
    (four spaces)

## Tables

| Left aligned | Centered | Right aligned |
|:-------------|:--------:|--------------:|
| apple        | red      | 1.25          |
| banana       | yellow   | 0.50          |
| cherry       | dark red | 12.00         |
| durian       | green    | 7.75          |

A wide table:

| ID | Name | Description | Owner | Created | Updated | Status | Priority | Notes |
|----|------|-------------|-------|---------|---------|--------|----------|-------|
| 1 | alpha | The first entry in a fairly wide table | alex | 2026-01-02 | 2026-10-20 | open | high | needs review |
| 2 | beta | Second entry | someone | 2026-02-03 | 2026-09-11 | closed | low | done |

## Images

An inline image with a relative path:

![A test diagram](images/diagram.svg "Diagram title")

A very wide image that should be scaled down to the column:

![Wide gradient](images/wide.png)

A broken image: ![missing image](images/does-not-exist.png)

A remote image, which must not load: ![remote](https://example.com/remote.png)

## Horizontal rule

Above the rule.

---

Below the rule.

## Footnotes section

Here is a footnote reference[^1], another one[^note], and the first again[^1].

[^1]: The first footnote.
[^note]: A named footnote with **formatting**.

## Raw HTML is shown as text

<div style="color:red">This should appear as literal text, not red.</div>

<script>alert("never runs")</script>

## Links

- [Relative Markdown link](readme.md)
- [Relative link with anchor](math.md#display-math)
- [Back to top](#kitchen-sink)
