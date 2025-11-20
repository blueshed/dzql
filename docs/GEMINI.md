# GEMINI.md - DZQL Monorepo

This document provides a comprehensive overview of the DZQL monorepo for Gemini, outlining the project's purpose, architecture, and development conventions.

## Project Overview

DZQL is a PostgreSQL framework that eliminates the boilerplate between your database and your application. It allows you to define your data model in SQL and instantly get a production-ready API with real-time updates, fine-grained permissions, and zero configuration.

The project is structured as a monorepo, with the core `dzql` framework located in the `packages/dzql` directory. The monorepo also includes several example applications that demonstrate how to use DZQL, such as a blog, a habit tracker, and a venue management system.

### Core Technologies

*   **Backend:** Node.js, PostgreSQL
*   **Frontend:** The client-side is framework-agnostic, but the examples use Vue.js.
*   **Real-time:** WebSockets are used for real-time communication between the server and clients.
*   **Package Manager:** The project uses `bun` as its package manager and runtime.

### Architecture

DZQL follows a database-first approach. The application's data model and business logic are defined in SQL, and DZQL automatically generates a corresponding API. This is achieved through the `dzql.register_entity` function, which is used to expose database tables as API endpoints.

DZQL supports two modes of operation:

*   **Runtime Mode:** In this mode, DZQL dynamically generates SQL queries at runtime. This is ideal for development and rapid prototyping.
*   **Compiled Mode:** In this mode, the DZQL compiler generates optimized PostgreSQL functions for your entities. This is recommended for production environments.

## Building and Running

The project uses `bun` for package management and running scripts. The following commands are essential for development:

*   **Install dependencies:**
    ```bash
    bun install
    ```
*   **Run the development server:**
    ```bash
    bun run dev
    ```
    This command starts the client and server concurrently.
*   **Run the database:**
    The project uses Docker to run the PostgreSQL database. The following command will start the database for the `venues` application:
    ```bash
    bun run venues:db
    ```
*   **Run tests:**
    ```bash
    bun test
    ```

## Development Conventions

*   **Monorepo:** The project is organized as a monorepo, with each package located in the `packages` directory.
*   **Database-first:** The application's schema and business logic are defined in SQL.
*   **Permissions:** Row-level security is defined declaratively using a JSON-based DSL.
*   **Real-time:** All database changes are automatically broadcast over WebSockets to connected clients.
*   **AI-assisted development:** DZQL is designed to be used with AI assistants. The AI can be used to write the SQL that defines the application's data model and business logic.
