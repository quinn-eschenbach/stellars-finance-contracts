# Soroban Smart Contract Development Guidelines

## General Principles and Style

* **Embrace Immutability:** Rust variables are immutable by default. Prefer immutability unless mutability is explicitly required, which makes code safer and easier to reason about.
* **Follow Naming Conventions:** Adhere to standard Rust naming: `snake_case` for variables and functions, and `CamelCase` for types (structs, enums, traits).
* **Use Tooling:** Integrate `rustfmt` to enforce consistent code formatting and `cargo clippy` to catch common mistakes and follow community best practices.
* **Prioritize Readability:** Write clear and understandable code. Avoid overly complex expressions and deep nesting, using early returns to keep logic linear.
* **Keep Code Local:** Define functions and variables as close as possible to where they are used to provide immediate context and minimize mental load when reading code.
* **Single Responsibility Principle & KISS:** Keep functions small and focused on a single task. Avoid over-engineering; keep the logic as simple as the requirements allow.

## Error Handling

* **Prefer Result and Option:** Use the `Result<T, E>` and `Option<T>` types for explicit, recoverable error handling and to represent the potential absence of a value.
* **Avoid `unwrap()` and `expect()` in Production:** These methods cause a program to panic if an error occurs. In production code, use the `?` operator for concise error propagation or handle errors gracefully.
* **Use Custom Error Enums:** In smart contracts, map your specific failure states to detailed custom error enums with explicit discriminants (e.g., `#[contracterror]`) rather than using generic errors.

## Leverage OpenZeppelin Stellar Contracts (Crucial)

* **Prefer Standard Libraries Over Custom Implementations:** Whenever possible, strictly use [OpenZeppelin Stellar Contracts](https://docs.openzeppelin.com/stellar-contracts) rather than writing your own implementations from scratch.
* **Core Modules to Utilize:**
* **Tokens:** Use OZ implementations for standard SEP-41 token interfaces.
* **Access Control:** Utilize OZ's `AccessControl` and `Ownable` modules for defining admin, keeper, and pauser roles instead of custom authentication routing.
* **Upgradeability & Initialization:** Always use OZ's `Initializable` pattern for setting up upgradeable contracts securely, and the `Upgradeable` module for WASM code replacements.
* **Security Features:** Rely on OZ's `Pausable` for emergency stops and emergency state management.


* **Why:** OpenZeppelin's code is audited, battle-tested, and represents the ecosystem standard. Minimizing custom code for standard behaviors drastically reduces the security surface area of the protocol.

## Modularity and Organization

* **Organize with Modules and Crates:** Use Rust's module system (`mod`, `pub mod`) for namespacing, scoping, and organizing code into logical units.
* **Separate Concerns:** Keep the primary contract file (`lib.rs`) focused on high-level routing and macro definitions, and delegate core functionality to dedicated sub-modules.

## Soroban & Blend-Specific Best Practices

Based on highly optimized repositories like `blend-capital/blend-contracts-v2`, follow these architectural patterns when building on Soroban:

* **Workspace Grouping:** Structure multi-contract protocols using a Cargo `[workspace]`. Group production contracts (e.g., `pool`, `pool-factory`, `backstop`), testing environments, and mocks (e.g., `mocks/mock-pool`) under a unified resolver.
* **Strict Math Safety:** Ensure `overflow-checks = true` is explicitly set in the `[profile.release]` section of the root `Cargo.toml`. Under no circumstances should this flag be removed, as doing so will compromise the mathematical safety of the contracts.
* **File Splitting for Complex Logic:** Do not dump complex transaction logic into one giant file. Split distinct operational flows into their own files. For instance, separate complex actions like submitting user operations into dedicated files (e.g., `pool/src/pool/submit.rs`) to keep the codebase maintainable.
* **Extensive Mocking and Testing:** Maintain a dedicated `test-suites` directory alongside `mocks` within the workspace. Use a dedicated `testutils` module (e.g., exposing a `Fixture::deploy` method) to easily spin up contracts and dependencies for testing.
* **Automated WASM Optimization:** Use a `Makefile` as a standard entry point to compile contracts to `cdylib` WebAssembly and rigorously optimize them using `stellar contract optimize`. Never deploy un-optimized WASM to the network.
* **Automated SDK Binding:** Generate frontend integrations programmatically. Use `stellar contract bindings typescript` inside your build scripts to ensure your TypeScript SDK stays perfectly synchronized with your WASM outputs.

## Strict TDD Multi-Agent Workflow

When tasked with implementing new smart contract logic (excluding basic boilerplate or minor bug fixes), you MUST act as the Orchestrator and strictly follow this Test-Driven Development (TDD) loop using your specialized subagents. Subagents help preserve context by keeping specific tasks out of your main conversation.

**The TDD Orchestration Loop:**

1. **Plan & Breakdown:** First, break the overarching requirement down into the smallest possible atomic units (e.g., "Implement the math for calculating the borrow fee index"). Create a markdown checklist in your main context.
2. **Delegate to Test Writer:** Explicitly invoke the `test-writer` subagent. Pass it the atomic requirement and instruct it to write comprehensive, failing tests. 
3. **Delegate to Code Writer:** Once the tests are written, explicitly invoke the `code-writer` subagent. Pass it the file paths to the newly created tests and the target implementation files. Instruct it to write the minimal code required to make the tests pass.
4. **Verify:** Run the test suite using your Bash tool. 
    * If tests fail: Send the error logs back to the `code-writer` subagent. Do not proceed until tests pass.
    * If tests pass: Check off the item on your plan and repeat Steps 1-4 for the next atomic requirement.
5. **Final Audit:** Once the entire feature checklist is complete and all tests are passing, explicitly invoke the `audit-agent` subagent. Pass it the completed module.
    * If it reports vulnerabilities: Break the fixes down into atomic units and restart the loop at Step 1.
    * If it reports "AUDIT PASS": The feature is complete.