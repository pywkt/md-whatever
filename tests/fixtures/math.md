# Math

Inline math like $x^2 + y^2 = z^2$ sits on the baseline of the text, and so
does $\frac{a}{b}$, $\sqrt{2}$, $e^{i\pi} + 1 = 0$ and $\sum_{i=1}^n i = \frac{n(n+1)}{2}$.
Greek letters $\alpha, \beta, \gamma, \Omega$ and sets $\mathbb{R}, \mathbb{C}, \mathcal{F}, \mathfrak{g}$.

## Display math

$$
\int_0^\infty e^{-x^2}\,dx = \frac{\sqrt{\pi}}{2}
$$

$$
\begin{aligned}
\nabla \cdot \mathbf{E} &= \frac{\rho}{\varepsilon_0} \\
\nabla \times \mathbf{B} &= \mu_0 \mathbf{J} + \mu_0 \varepsilon_0 \frac{\partial \mathbf{E}}{\partial t}
\end{aligned}
$$

A matrix:

$$
A = \begin{pmatrix} 1 & 2 & 3 \\ 4 & 5 & 6 \\ 7 & 8 & 9 \end{pmatrix}, \quad
\det\begin{vmatrix} a & b \\ c & d \end{vmatrix} = ad - bc
$$

Cases:

$$
|x| = \begin{cases} x & \text{if } x \ge 0 \\ -x & \text{otherwise} \end{cases}
$$

A fenced math block:

```math
P(A \mid B) = \frac{P(B \mid A)\,P(A)}{P(B)}
```

## Symbols in ordinary text

Unicode symbols without math markup: ∀x ∈ ℝ, ∃y ≤ x · ∑ ∏ ∫ ∂ ∇ ≈ ≠ ≡ ⊂ ⊆ ∪ ∩ ⊗ ⊕ → ⇒ ⇔ ℵ₀ ∞ ½ x² Hₙ.

## Not math

It costs $5 and $10, so \$15 in total. A lone dollar: $ and code `$x$`.

## Errors

An undefined command shows in red inside the formula: $\badmacro{x} + 1$.

A syntax error shows the source: $\frac{1}{2$.
