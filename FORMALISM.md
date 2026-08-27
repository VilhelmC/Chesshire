# Tactics from material and rationality alone

A corrected formalism for exchange evaluation, constrained defenders, obligations,
and tempo.

This supersedes the *Positional Evaluation and Exchange Graphs* sketch. It keeps
that document's architecture — SEE as the primitive, conflicts as graphs, tempo as
the scarce resource — and repairs the places where the mathematics does not hold.
§0 lists what changed and why, so the two can be read side by side.

Everything below is built from exactly three inputs:

1. **Material values** $v: \mathcal{P} \to \mathbb{R}_{\ge 0} \cup \{\infty\}$, with $v(K) = \infty$.
2. **Rationality** — either side may decline any continuation.
3. **Strict alternation** — one action per ply.

No positional term appears anywhere in §§1–6. That is deliberate and it is the
main structural change: the tactical layer must be computable *before* any notion
of piece activity exists, because activity is defined in terms of it.

---

## 0. What changed from the sketch, and why

| § | Sketch | Status |
|---|---|---|
| 1 | $v(p) = \text{Mob}_{rel}(p) + \text{Safety} + \dots$, with $\text{Mob}_{rel}$ defined by value | **Circular; no fixed point guaranteed.** Demoted to §7, downstream of everything. |
| 2.1 | participants sorted ascending, cheapest captures first | **Not exact with a dynamic participant set** — which capture happens decides which slider is revealed. Step $j$ branches over $C_j$ (§1.1). Found by testing, not by reading. |
| 2.3 | backward $\min$ at odd $k$ | **Parity off by one.** The decision at ply $k{+}1$ belongs to whoever moves at $k{+}1$. |
| 2.3 | SEE $> 0$ valid, $\le 0$ invalidated | **Contradicts §1's "preserve or improve".** An even trade preserves. Threshold is $\ge 0$. |
| 2 | only "my capture on $S$" is defined | **Half the filter is missing.** The safety of a quiet move is the same function run from the other end (§1.6). |
| 2 | promotion absent from the chain | **Misprices a promoting capture by ~8 pawns**, and breaks the optimality of ascending order (§1.1a). |
| 2 | en passant absent | **The prize is not on the target square.** Local repair at step 0 (§1.1b). |
| 4.1 | "sorting over the in-degree edges of $S$" | **False.** Batteries and x-rays join mid-chain. Correct static form in §1.2. |
| 4.1 | nodes = pieces, edges = piece→piece | **Cannot express an empty square**, which §8 needs throughout. Bipartite piece↔square. |
| 4.3 | $\text{Cost}_{\text{eff}} = v(p) + \max(0, \text{SEE}(G_2\mid\text{present}) - \text{SEE}(G_2\mid\text{removed}))$ | **Sign inverted; non-modular; unsound substitution.** Replaced by a $\min$ over conflicts (§2). |
| 6.2 | $v_{\text{eff}} = v(p_{pin}) + (v(p_{behind}) - v(p_{attacker}))$ | **Special case.** General form is a nested SEE (§2.2). |
| 6.2 | inflate $v$ to push the piece down the sort | **Breaks the exchange argument** that justifies ascending order (§2.4). |
| 7.1 | $\lvert\text{Resolved edges per ply}\rvert \le 1$ | **False.** One move can resolve many. Replaced by a covering condition (§3). |
| 7.3 | "Black defends the higher-value target" | **Greedy, not optimal.** Replaced by a $\min\max$ (§3.3). |
| 5.4 | check ⟹ recapture score $-\infty$, attacker "retains unconditionally" | **Unsound.** A check defers a recapture; it does not delete it (§4.3). |
| 8.2 | reserves join the chain at step $m \ge 2d - \mathbf{1}$ | **Contradicts §5.** Inside a live chain there are no spare tempi (§4.1). |

Two results in the sketch survive untouched: the absolute-pin edge deletion, and
$v(K) = \infty$. The second turns out to do more work than it was given credit for
(§4.4).

The two items this document itself first listed as open — free interruptions, and
whether mobility is a count or a predicate — have since been narrowed to checkable
conditions in §8. Neither is closed.

---

## 1. The exchange

### 1.1 The chain is a dynamic object

Fix a target square $S$ holding a piece of the defending side, with the attacking
side to move. Define a sequence of boards $\pi_0, \pi_1, \dots$ and captured values
$c_0, c_1, \dots$:

- $\pi_0$ is the position; $t_0 = v(\text{piece on } S)$; side$_0$ = attacker.
- At step $j$, let $C_j$ be the pieces of side$_j$ attacking $S$ **under the occupancy of $\pi_j$**, excluding any piece on $S$ itself and any piece forbidden from $S$ by an absolute constraint (§2.1). If $C_j = \varnothing$, set $N = j$ and stop.
- **each** $p_j \in C_j$ is a branch: $c_j = t_j$ (plus §1.1a if it promotes), $t_{j+1} = v(p_j)$, and $\pi_{j+1} = \pi_j$ with $p_j$'s origin square vacated.

The recomputation of $C_j$ against a shrinking occupancy is not an optimisation.
It is what makes batteries and x-rays fall out: a slider behind its own blocker has
no edge to $S$ at step 0 and acquires one the moment the blocker captures.

**And it is why cheapest-first is not the rule.** Earlier drafts of this section wrote
$p_j = \arg\min_{p \in C_j} v(p)$, following the sketch and every textbook description
of SEE. That is wrong here, and the reason is structural rather than a detail.

The exchange argument that justifies ascending order — swap two adjacent captures to
put the cheaper first, and the mover is weakly better off — **assumes the participant
multiset is fixed.** With a dynamic $C_j$ it is not: which piece captures decides which
square is vacated, and therefore which slider behind it joins. Swapping two captures
changes the participants, so the argument does not apply and the conclusion does not
hold.

A generated position found it. A rook on h6 and a queen on e4 both attack h7, with a
black queen on h4 and the king on g8:

- $♖h6{\times}h7$ vacates h6, revealing $♛h4$ down the file. The recapture wins.
- $♕e4{\times}h7$ leaves the rook on h6 backing up the square, so the king may not
  recapture at all — and White wins a pawn.

Cheapest-first plays the rook and reports $0$. The answer is $100$.

So step $j$ is a **branch over $C_j$, not a choice**, and §1.2's recurrence takes the
max over it. The cost is small: the branching factor is the number of capturers of one
side, typically two or three.

Cheapest-first remains correct for a *static* participant set, which is why the
textbook version is sound in its own setting and unsound in this one.

### 1.1a Promotion, and the theorem it costs

If $p_j$ is a pawn and $S$ lies on its promotion rank, it arrives as a queen. Both
step quantities change:

$$c_j \;=\; t_j + \big(v(Q) - v(P)\big), \qquad t_{j+1} \;=\; v(Q)$$

Omitting this misprices a promoting capture by roughly eight pawns.

Promotion was a second reason to distrust ascending order — a promoting pawn risks
$v(Q)$ while costing $v(P)$, so it is neither the cheapest nor the dearest participant.
Once §1.1 branches over $C_j$ rather than choosing, this needs no separate treatment:
the promoting capture is one branch among the others, priced correctly, and the max
selects it exactly when it is best.

### 1.1b En passant

An en-passant capture removes a pawn that is **not on the target square**, so the
chain's premise — that the prize stands on $S$ — fails outright.

It can only ever be step $0$, because the right expires immediately, and that makes the
repair local: set $c_0 = v(\text{pawn})$, vacate the **captured pawn's** square rather
than $S$, and note that this vacating may itself open a ray into $S$. From step $1$ the
ordinary definition resumes.

**Static characterisation.** If you want the participant set without simulating,
the correct statement is a transitive closure along rays, not an in-degree count:

> Slider $q$ on the ray to $S$ participates **iff every piece between $q$ and $S$ on
> that ray is itself a participant.**

Sorting over the in-edges of the initial graph is wrong exactly on batteries and
x-rays, which is to say on most of what makes exchanges interesting.

### 1.2 Value

$$S(N) = 0, \qquad S(j) = \max\big(0,\; c_j - S(j+1)\big), \qquad \mathrm{SEE}(\pi, S) := S(0)$$

$S(j)$ is the gain to the side moving at step $j$, from that side's own point of
view. The $\max(0,\cdot)$ is rationality: nobody is forced into an exchange.

### 1.3 Equivalent prefix form

The sketch's cumulative form, with the parity corrected:

$$V[k] = \sum_{i=0}^{k} (-1)^i c_i, \qquad G[N] = V[N]$$
$$G[k] = \begin{cases}\min\big(V[k],\, G[k{+}1]\big) & k \text{ even (defender decides next)}\\[2pt] \max\big(V[k],\, G[k{+}1]\big) & k \text{ odd (attacker decides next)}\end{cases}$$
$$\mathrm{SEE} = \max\big(0,\, G[0]\big)$$

$V[k]$ is the score *if the exchange stops after ply $k$*; $G[k]$ is the score given
that plies $0..k$ happened and play continues optimally. The player deciding after
ply $k$ is the one moving at ply $k{+}1$ — which is where the sketch's off-by-one
comes from, since it labels $k$ by whose capture it was.

The two forms agree. Checked on $c = (5,1)$: negamax $S(0) = \max(0, 5-1) = 4$;
prefix $G[1] = 4$, $G[0] = \min(5,4) = 4$. And on $c = (1,9)$: negamax
$S(0) = \max(0, 1-9) = 0$; prefix $G[0] = \min(1,-8) = -8$, $\max(0,-8) = 0$.

### 1.4 The king needs no special rule

With $v(K) = \infty$, a king that captures into a defended square produces
$S(j) = \max(0, c_j - \infty) = 0$ — the recurrence declines it. A piece that
"captures the king" produces $c_j = \infty$, and that branch is never chosen by the
opposing side.

$\infty - \infty$ cannot arise: at most one $c_j$ in a single chain can be $\infty$,
because the two kings cannot both be captured on one square, so $S(j+1) < \infty$
whenever $c_j = \infty$. Extended-real arithmetic is safe throughout, and the legality
of check is a **consequence** of the value assignment rather than a rule bolted onto it.

### 1.5 The cheap-attacker lemma

> **Lemma.** Let $t$ be the value of the piece on $S$ and $a = \min_{p \in C_0} v(p)$ the
> cheapest **participating** attacker — participating in the sense of §1.1, so
> absolutely pinned attackers are already excluded. If $a < t$ then
> $\mathrm{SEE}(\pi, S) \ge t - a > 0$, **for any number of defenders**.

*Proof.* After the first capture, a piece of value $a$ stands on $S$, so
$S(1) = \max(0,\, a - S(2)) \le a$. Hence
$S(0) = \max(0,\, t - S(1)) \ge t - a > 0$. The bound does not mention $|D|$. $\blacksquare$

The bound survives promotion and improves under it: if the first capture promotes then
$S(1) \le v(Q)$ and $c_0 = t + v(Q) - v(P)$, giving
$S(0) \ge t - v(P) \ge t - a$.

> **Corollary.** Adding a defender discharges a threat **only if** the cheapest
> attacker is worth at least the target.

This removes "defend it" from the candidate set in the common case, for a provable
reason rather than a heuristic one. In practice it is most of the pruning.

### 1.6 Both directions of the same function

The sketch defines only *"what do I win by capturing on $S$."* The other direction is
needed far more often and is the same recurrence with the arguments swapped:

- $\mathrm{SEE}^{\text{cap}}(\pi, S)$ — side to move is the attacker, $S$ holds an enemy piece. **Is this capture good?**
- $\mathrm{SEE}^{\text{safe}}(\pi, m)$ — play quiet move $m$ landing a piece on $S$, then evaluate $\mathrm{SEE}^{\text{cap}}$ for the **opponent** with that piece as target. **Is this square safe?**

Every non-capture move in the game is filtered by the second, so a formalism that
defines only the first has defined a small fraction of what it needs.

### 1.7 Acceptance

A move is tactically admissible iff it does not lose material:
$\mathrm{SEE}^{\text{safe}} \le 0$ for a quiet move, $\mathrm{SEE}^{\text{cap}} \ge 0$
for a capture. **$\ge$, not $>$** — an even trade preserves material, and the sketch's
own worked example lands on exactly $0$.

---

## 2. Constrained defenders

A pin and an overload are the same object: a defender whose participation is not
free. One rule covers both.

### 2.1 The rule

Let $p \in D$ be a defender of $S$ whose participation costs $X \ge 0$ **elsewhere**.
The defender chooses whether to use it, so:

$$\boxed{\;\mathrm{SEE}(S) \;=\; \min\Big(\ \mathrm{SEE}\big(S \mid p \in D\big) + X,\ \ \mathrm{SEE}\big(S \mid p \notin D\big)\ \Big)\;}$$

signed from the attacker's point of view throughout. Both branches are ordinary
chains; nothing is edited inside either one.

Instances:

- **Absolute pin** (behind-piece is the king): $X = \infty$, so the first branch never wins — equivalently, delete $p$ from $D$ outright, and delete every edge $p \to S'$ for $S'$ off the pin ray. The ray **includes the pinner's own square**: a pinned piece may capture the pinner.
- **Relative pin**: $X = \mathrm{SEE}^{\text{cap}}\big(\mathrm{sq}(p_{behind}) \mid p \text{ off the ray}\big)$ — a *nested exchange*, not $v(p_{behind}) - v(p_{attacker})$. That difference is the special case where the behind-piece is defended exactly once and the trade is even. If the behind-piece is loose, the cost is its whole value.
- **Overload**: $X = \mathrm{SEE}^{\text{cap}}\big(S_2 \mid p \text{ absent}\big)$ — what the second square is worth once its only guard has left.

### 2.2 Why not inflate the value instead

The sketch's alternative — set $v_{\text{eff}}(p) = v(p) + X$ and let the ascending
sort push $p$ to the back — fails for three reasons.

**It has the sign backwards.** With SEE signed from the initiator's view (the usual
convention), removing a defender *raises* $\mathrm{SEE}(G_2)$, so
$\max(0,\ \mathrm{SEE}(\text{present}) - \mathrm{SEE}(\text{removed}))$ is identically zero.

**It is not modular.** With two shared defenders, each $\mathrm{Cost}_{\text{eff}}$ is
computed with the other still present, but committing both changes both. The loss as
a function of the committed set is not a sum of node weights — it is a matching, and
matchings do not decompose.

**It corrupts the chain.** Ascending order is justified by an exchange argument on
*material actually lost*: swapping two adjacent captures to put the cheaper first
weakly improves the mover's outcome. Sort by an inflated key and the resulting number
is no longer the material outcome of any sequence. For an engine returning a scalar
that may be tolerable. For a system whose purpose is to show the line, it reports a
sequence that will not happen.

### 2.3 Harvest parity

$X$ assumes the second square is collected for free. Whether it is depends on where
the first chain stops.

The chain at $S_1$ runs attacker (ply 0), defender (ply 1), attacker (ply 2), …
If the last capture played is at ply $j$, the next ply belongs to the other side.

> $X$ is collected free **iff $j$ is odd** — iff the defender made the last capture.
> If the attacker made it, the defender gets a tempo first and $X$ must be recomputed
> against a position where the second square can be reinforced.

This is a two-line check and it is the difference between an overload that wins and
one that evaporates.

---

## 3. Obligations and the covering condition

### 3.1 Definitions

An **obligation** on side $c$ is a pair $(S, w)$ with
$w = \mathrm{SEE}^{\text{cap}}(\pi, S) > 0$ for the opponent. Write $E(\pi, c)$ for the
set of them.

For a legal move $m$ of side $c$, define

$$\mathrm{Resolves}(m) \;=\; \big\{\, e \in E \;:\; \mathrm{SEE}^{\text{cap}}(\pi \cdot m,\, S_e) \le 0 \,\big\}$$

Note what this admits. Moving the piece resolves; adding a defender resolves *only
under §1.5's corollary*; capturing the attacker resolves; blocking a ray resolves;
and a move can resolve an obligation it never touches, by removing the attacker's
ability to act.

### 3.2 Pigeonhole is the wrong principle

The sketch asserts $|\mathrm{Resolved\ edges\ per\ ply}| \le 1$. This is false. One
move can resolve arbitrarily many obligations:

- capturing the forking piece resolves *every* threat it makes;
- interposing on a line can cut two threats along that line at once;
- a king step can leave check and simultaneously defend a loose piece.

What is actually true is $|\{\text{moves per ply}\}| = 1$. The scarcity is in **moves**,
not in resolutions, and a fork is not a counting fact about threats.

### 3.3 The correct condition

$$\textbf{deficiency} \iff \nexists\, m \in M_{\text{legal}} \;:\; E \subseteq \mathrm{Resolves}(m)$$

A **covering** condition. And the amount conceded, for two obligations:

$$L(E) \;=\; \min_{m \in M_{\text{legal}}} \;\; \max_{e \,\notin\, \mathrm{Resolves}(m)} \;\; \mathrm{SEE}^{\text{cap}}\big(\pi \cdot m,\, S_e\big)$$

The terminal quantity is a **SEE, not a raw piece value** — the harvest may be
recaptured. For $|E| > 2$ this unrolls rather than closing in one $\max$: the opponent
spends a ply harvesting, you get a ply back, and the recursion continues on the
remaining obligations.

The sketch's "Black defends the higher-value target" is a greedy rule and it is wrong
whenever some move covers both prongs, or covers the cheaper prong while a recapture
makes the dearer one unprofitable to take.

### 3.4 What this unifies

Fork, double attack, overloaded defender, and zugzwang are the same predicate at
different scopes:

| motif | $E$ | why no cover exists |
|---|---|---|
| fork | two obligations created by one move | no single reply reaches both squares |
| double attack | two obligations, distinct attackers | same |
| overload | two obligations sharing one discharge | the one move that covers each cannot be played twice |
| trapped piece | one obligation, scoped to one piece's moves | no destination has $\mathrm{SEE}^{\text{safe}} \le 0$ |
| zugzwang | one obligation, scoped to all moves | every legal move creates a worse one |

§2's constrained-defender rule is the same condition specialised to the case where
the candidate moves are uses of a single piece — which is why it can be stated as a
$\min$ over two branches rather than as a search.

---

## 4. Two clocks

The sketch's §5 and §8 contradict each other, and the contradiction is informative.

### 4.1 Inside a live exchange there are no spare tempi

§8.2 admits a reserve piece to the chain at step $m \ge 2d - \mathbf{1}$. This cannot
happen. Every ply of a live chain is consumed by a recapture. If the defender spends
a ply mobilising a $d = 1$ reserve instead of recapturing, the chain has **terminated**
— the attacker's piece stands on $S$ unchallenged and has already banked the material.
So a reserve can never "arrive at step 2 of a chain that is still running", because the
chain is only still running on the condition that nobody had a spare move.

Therefore:

> **Forced phase.** A chain is live. Every ply is a capture. The participant set is
> fixed modulo x-ray reveals. $\mathrm{SEE}$ is exactly the value of this phase.
> Mobilisation distance is meaningless here.
>
> **Quiet phase.** Free tempi exist. $d(p, S)$ is meaningful. Obligations accumulate
> and §3's covering condition decides whether a deficiency exists.

Positions alternate between the two. Reserves matter *between* exchanges, never inside
one.

### 4.2 A zwischenzug is the transition

This gives a criterion instead of a special case. Let $\sigma_k = S(k)$ be the **stake**
— what the side to move at ply $k$ gains by continuing the chain.

> A non-chain move $m$ may interrupt at ply $k$ **iff** what it gains exceeds what
> declining forfeits: $\mathrm{gain}(m) > \sigma_k$.
>
> (If $m$ preserves the recapture right — the sketch's "resolving recapture" — the
> forfeit is $0$ and the condition is vacuous.)

This is also the answer to *which moves are worth expanding*: the ones whose stake
exceeds the current stake. Not a heuristic — a consequence of rationality.

### 4.3 What a check actually does

The sketch sets the defender's recapture to $-\infty$ and has the attacker "retain the
piece unconditionally". That is unsound. A check does not delete the recapture edge; it
**defers it by two plies and hands the attacker one free action**. The attacker must
then choose:

$$\max\Big(\underbrace{V[k] - \text{cost of the escape square}}_{\text{spend the free ply keeping the piece}},\;\; \underbrace{V[k{+}2] + \mathrm{gain}(a)}_{\text{spend it elsewhere, allow the recapture}}\Big)$$

with both branches evaluated *after* whatever the check-answering move did to the board.
$V_{\text{tempo}}[k{+}1] = V[k]$ is an **upper bound**, not the value.

The sketch also models only the initiator checking. The same mechanism belongs to the
defender, and the defender's zwischenzug is the case that breaks naive implementations:
a check that merely *delays* a capture by one ply scores identically to one that
*prevents* it, unless the position is re-evaluated after the forced answer.

### 4.4 Termination, and why check is special

Along any chain of forfeiting interruptions, §4.2 forces the stake to strictly
increase. Material is bounded, so there are finitely many such interruptions and the
escalation terminates.

With $v(K) = \infty$, **check is the maximal element of that order.** Nothing can
exceed it, so a check cannot be interrupted — only answered. This is why check is the
most forcing move available, derived from the value assignment rather than asserted as
a rule. It is the same fact as §1.4 seen from the tempo side.

The residual case is the *free* interruption — a move that threatens while preserving
the recapture right. It does not force the stake up, so termination there rests on the
number of distinct threat configurations being finite. True, but a weaker argument, and
worth flagging as the soft spot in the well-foundedness.

---

## 5. Mobilisation, in the quiet phase only

$$d(p, S) = \min\{\, k \in \mathbb{N}_0 \;:\; p \text{ can attack or defend } S \text{ in } k \text{ plies} \,\}$$

computed on a frozen board, which is an approximation in both directions — routes open
and routes close. Stated, not hidden.

Because the two sides alternate, a race to assemble is decided *before* the first
capture. If the attacker needs $k_A$ preparatory moves and the defender $k_D$, the
defender arrives in time iff $k_D \le k_A$ — and each preparatory move is itself
subject to §1.6, so a mobilisation that walks into a losing $\mathrm{SEE}^{\text{safe}}$
does not count as arriving.

**Tenability.** Before spending a tempo on defence, ask whether the defence changes the
answer:

$$\text{worth defending} \iff \mathrm{SEE}\big(S \mid \text{reinforced}\big) \le 0 \;\wedge\; k_D \le k_A$$

If either fails, the square is a lost cause and the tempo is better spent elsewhere.
Note §1.5 makes the first conjunct decidable without simulation whenever the cheapest
attacker is worth less than the target: it is automatically false.

**Siphoning** is then a statement about the distance function rather than a separate
motif. Forcing $p$ to commit to $S_1$ takes $d(p, S_1) \to 0$ and $d(p, S_2) \to 2$ or
$\infty$. Whether the commitment is *forced* is decided by §3.3, so siphoning is a
corollary of the covering condition, not an independent mechanism.

---

## 6. What the tactical layer does not need

Everything in §§1–5 uses material values, rationality, and alternation. It uses no
notion of activity, space, coordination, or king safety. That is not an aesthetic
preference — it is required, because effective mobility is defined *in terms of* the
tactical layer:

$$\mathrm{Mob}_{rel}(p) \;=\; \{\, m \text{ a move of } p \;:\; L\big(E(\pi \cdot m)\big) \le 0 \,\}$$

If the tactical layer consumed $\mathrm{Mob}_{rel}$ in turn, the system would be
circular. The sketch's §1 does exactly that:
$v(p) = \mathrm{Mob}_{rel}(p) + \dots$ with $\mathrm{Mob}_{rel}$ defined by value gives
$V = F(V)$, and $F$ is **discontinuous** — $\mathrm{Mob}_{rel}$ is a threshold count,
piecewise constant in $V$, jumping as moves cross the boundary. Brouwer does not apply
and existence is not guaranteed. A 2-cycle is constructible: at $V$ a trade preserves
value, so it joins $\mathrm{Mob}_{rel}(p)$, so $v(p)$ rises, so the same trade now loses
value, so $v(p)$ falls.

Making the threshold soft restores continuity and hence existence, and uniqueness then
needs $F$ to be a contraction — which holds only if $\partial v / \partial M$ is small,
i.e. only if the positional term is a small perturbation on material. That is probably
true and it is an assumption, not a theorem.

The clean resolution is the one taken here: **material values are constants inside the
evaluation; mobility is an output.** There is no fixed point to solve.

### A note on cardinality

Every motif in §3.4 is a set becoming **empty**, not a set becoming small. A knight
with eight safe squares and one with a single safe square are both untrapped. If that
holds generally — and I have not found a tactical motif that is about $|\mathrm{Mob}_{rel}|$
rather than about $\mathrm{Mob}_{rel} = \varnothing$ — then $\mathrm{Mob}_{rel}$ is doing
two unrelated jobs: a **predicate** for tactics and a **scalar** for positional value.
They should be separated, and only the predicate belongs in §§1–5.

---

## 7. The pedagogy

Each result above has a reading a human can use at the board. These are consequences,
not rules of thumb — which is the point of deriving them.

**§1.5 — the cheapest attacker decides.**
> If it is attacked by something cheaper than it, adding defenders is wasted effort.
> Move it, take the attacker, or block. Count the *cheapest* attacker first, not the
> number of attackers.

**§1.6 — one sum, two directions.**
> "Can I take it?" and "is that square safe?" are the same calculation run from
> opposite ends. Beginners learn the first and guess at the second.

**§2.1 — a defender with two jobs is not half a defender.**
> Work out the position twice — with it and without it — and assume they take the
> cheaper loss. Never average.

**§2.3 — who made the last capture.**
> If they made the last capture, you move next and collect the other thing for free.
> If you made it, they get a move first and it may not be there.

**§3.3 — ask the covering question, not the counting question.**
> Not "how many things are attacked" and not "can I save the queen", but: *is there
> one move that answers all of it?* Look hardest for the move that answers two —
> capturing the forker, or a block that cuts both lines.

**§4.2 — the stake governs interruptions.**
> You may only interrupt an exchange with something bigger than what is already on
> the table. This is why most "clever in-between moves" fail: they are smaller than
> the thing being abandoned.

**§4.4 — why check always works and is the only thing that always works.**
> Check is worth infinity, so it is bigger than every stake. That is the whole content
> of "forcing". It also means a check that only delays and a check that refutes look
> identical for exactly one ply — so always look one move past the king's escape.

**§4.1 — two clocks.**
> Bringing another piece up is a peacetime activity. Once the captures start, nobody
> has a spare move. If your plan needs a developing move in the middle of an exchange,
> the plan does not exist.

**§5 — decide before you spend.**
> Before defending, ask whether the defence arrives in time *and* changes the answer.
> If either fails, it is gone whatever you do — spend the move on your own threats.

---

## 8. The two residuals, narrowed

Both items previously listed here as open have been reduced. Neither is closed, but
each is now confined to a stated, *checkable* condition rather than left as a general
worry.

### 8.1 A free interruption requires a trapped prize

Suppose the chain is live at ply $k$ for side $X$ — that is, $S(k) > 0$, so $X$ gains by
continuing — and $X$ instead plays a non-chain move $m$. Side $Y$ now moves, and among
$Y$'s options is **evacuating the prize from $S$**. If any evacuation is profitable for
$Y$, then $X$ has forfeited $S(k)$ and the interruption was not free.

So the interruption is free only if the prize cannot leave — that is, only if its escape
set is empty. That is exactly the **trapped** condition of §3.4, computed with machinery
already defined.

> **Consequence.** In any position where the prize has a safe square, no free
> interruption exists, so §4.4's strict-increase argument applies unconditionally and
> termination is guaranteed.

The residual is now confined to trapped-prize positions, and it is *detectable* rather
than lurking: an implementation can test the precondition and fall back to a ply cap
only there. What remains genuinely unproved is termination *within* such a position,
where $X$ may in principle chain compelling threats while the prize stays trapped;
that still rests on finiteness of threat configurations rather than on a monotone
quantity.

### 8.2 Cardinality carries no tactical content

The claim in §6 can be argued rather than merely asserted.

A tactical claim is a claim about material changing hands. Material changes hands only
when the covering condition of §3.3 fails, or when a piece has no non-losing move —
both of which are statements that a set is **empty**. A piece with three safe squares
and one with seven produce identical material outcomes at the current ply; nothing in
§§1–5 reads $\lvert \mathrm{Mob}_{rel} \rvert$.

A small non-zero count can still matter, but only by becoming zero after further
attacking tempi — and that is already the mobilisation question of §5, not a second
quantity. So cardinality enters tactics only as *deferred emptiness*, and it is the
number of tempi, not the count, that does the work.

This is an argument, not a proof: it rests on the claim that §§1–5 exhaust the tactical
layer, which is precisely what §9 sets out to measure. If a motif turns up that needs
the count itself, that is the counterexample and this section is wrong.
