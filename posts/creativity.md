---
title: on the unreasonable creativity of ai
date: 2026-05-27
description:
---


What counts as creativity?
Writing a book? Proving a theorem? Discovering a new move in a board game?

Perhaps, for a human, these have been age-old benchmarks of a creative mind. Yet, as we enter an age where artificial intelligences are capable of these tasks and more, why do people waver in ascribing creativity to the machine? To me, this is rather strange.

In these and other 'creative' endeavors, certain aspects are shared.

1. There are a finite number of rules delineating the structure of the endeavor. In mathematics, these are your starting axioms. Choosing one set of axioms (e.g. Riemannian geometry) over others (e.g. Euclidean geometry) leads to vastly different outcomes in the describable forms, i.e. set of possible proofs. In analogy, one could think of playing tennis, but altering the rules so that the net sits high above the ground, and the ball has feathers and can't bounce - you've now transformed tennis into badminton! The rules define the 'playing style', defining what actions are possible.
2. Despite the finite ruleset, the number of composable forms can be many, even infinite. From the simple rules of chess, about 4.82x10^44 possible board positions exist. Playing a chess match means traversing from the one starting position, through an ordered subset of these 4.82x10^44 possible board combinations, to reach either an unresolvable board position that can continue ad infinitum; or which simply ends in a win. Or, consider the 26 letters of the English alphabet and the number of possible sentences. Rules for creative endeavors are highly expressive.
3. What we call creativity is often in reference to solving how to traverse the multitude of forms to reach a desired state.

Artificial intelligence as we know it today is trained on a wide variety of human data. This data contains the rules to myriad games/tasks/endeavors, and the 'playing styles' of thousands of human professionals.

Despite, or perhaps because of, the multitude of possible forms that can be generated, humans have built up heuristics for exploring the full search space of forms. This is rarely exhaustive; it leaves room for surprises.

Artificial intelligence that has internalized the rules, and which has the compute to generate forms rapidly, does not need to rely on said human heuristics to explore the search space. Rather, emergent from the data are learnable features with which an AI model can use to map out how forms relate to each other. These may not be obvious to humans, as was the case when AlphaGo stumped Lee Sedol with a novel move that was not in its training data.

This is also why AI agents for programming is such a powerful idea. Humans have produced a huge corpus of code for training data. Code is not only inherently modular, but also has a set of expressive, finite rules relating to syntax, ordering, and hierarchy. An AI can understand all levels of this simultaneously, and iterate on timescales faster than any human.

As I build with AI agents, this suggests the following practices:
- Define the rules of the use case for the AI to play with.
- Outline positive examples arrived at from composing the above rules.
- Set up a feedback loop to evaluate the generated forms returned by the agent.
I'm excited to see if more complex problems can be mapped onto simple rulesets that are just as composable.