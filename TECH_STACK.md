# Tech Stack: Devin API Event-Driven Automation

**Technology Stack**: TypeScript + Node.js + Express.js

## Core Automation Service

### Language: TypeScript 5+
- **Why**: Strong typing, excellent async/await support, modern tooling
- **Benefits**: Rich ecosystem for webhooks, API integrations, and serverless functions
- **Developer Experience**: Great VS Code integration with IntelliSense

### Runtime: Node.js 20+ or Bun
- **Why**: Node.js for stability and ecosystem, Bun for performance (optional)
- **Benefits**: Both have excellent TypeScript support
- **Compatibility**: Mature npm ecosystem with comprehensive package availability

### Web Framework: Express.js
- **Why**: Express for familiarity and ecosystem
- **Benefits**: 
  - Mature ecosystem and middleware support
  - TypeScript integration with @types/express
  - Easy webhook handling with body-parser
  - Extensive community support and documentation
- **Alternative**: Fastify for performance (if needed)

### HTTP Client: axios
- **Why**: axios for reliability and interceptors
- **Benefits**: 
  - Reliable HTTP client with excellent TypeScript support
  - Request/response interceptors for logging and auth
  - Automatic JSON parsing
  - Better error handling than native fetch
- **Alternative**: Native fetch for zero dependencies

## Event Trigger

### GitHub Webhooks: Issue Creation Events
- **Why**: Native integration with GitHub, easy to test, clear event model
- **Trigger**: `issues` event with `action: opened`
- **Benefits**:
  - Native integration with the repository
  - Clear event model
  - Easy to test locally with ngrok
  - Scalable and production-ready

## Observability

### Logging: winston
- **Why**: Mature logging library with excellent TypeScript support
- **Benefits**:
  - Structured JSON logging
  - Multiple transports (console, file, cloud)
  - Log levels and formatting
  - Easy integration with monitoring systems

### Metrics: Simple File-Based System
- **Why**: JSON file for metrics persistence
- **Benefits**:
  - No external dependencies (no database needed)
  - Easy to inspect and debug
  - Sufficient for demo scope
  - Can be upgraded to real metrics system later

### Status Dashboard: Basic Express Endpoint
- **Why**: Simple HTTP endpoint for status visualization
- **Benefits**:
  - Easy to implement with Express
  - Can return JSON or simple HTML
  - Extensible for future enhancements

## Containerization

### Docker
- **Why**: For consistent deployment
- **Benefits**:
  - Consistent environment across machines
  - Easy deployment and testing
  - Standard for production services
  - Simplifies "run instructions" requirement

### Docker Compose
- **Why**: For local development and testing
- **Benefits**:
  - Easy local development setup
  - Multi-container support if needed
  - Environment variable management
  - Volume mounting for development

## GitHub Integration

### octokit: GitHub's Official TypeScript/JavaScript Library
- **Why**: Official library, excellent TypeScript support, comprehensive API coverage
- **Benefits**:
  - Official library maintained by GitHub
  - Excellent TypeScript support with auto-generated types
  - Comprehensive API coverage (REST, GraphQL, webhooks)
  - Easy PR creation, issue management, webhook verification
  - Built-in authentication and rate limiting

---

## Key Architectural Decisions

### 1. GitHub Webhook Trigger
**Decision**: Use GitHub webhooks on issue creation
**Rationale**: 
- Native integration with the repository
- Clear event model
- Easy to test locally with ngrok
- Scalable and production-ready

### 2. Express.js for Webhook Handler
**Decision**: Express.js over other Node.js frameworks
**Rationale**:
- Mature ecosystem and middleware support
- TypeScript integration with @types/express
- Easy webhook handling with body-parser
- Extensive community support and documentation

### 3. Simple File-Based Metrics
**Decision**: JSON file for metrics persistence
**Rationale**:
- No external dependencies (no database needed)
- Easy to inspect and debug
- Sufficient for demo scope
- Can be upgraded to real metrics system later

### 4. Docker Containerization
**Decision**: Single Docker container with docker-compose
**Rationale**:
- Consistent environment across machines
- Easy deployment and testing
- Standard for production services
- Simplifies "run instructions" requirement

### 5. Issue Labeling Strategy
**Decision**: Use specific labels to trigger automation
**Rationale**:
- Fine-grained control over what gets automated
- Manual override capability
- Clear categorization of automation scope
- Easy to extend to different issue types

---

## Dependency Overview

### Production Dependencies
- `express` - Web framework
- `octokit` - GitHub API client
- `axios` - HTTP client for Devin API
- `winston` - Logging
- `dotenv` - Environment variable management

### Development Dependencies
- `typescript` - TypeScript compiler
- `@types/*` - Type definitions
- `ts-node` - TypeScript execution
- `nodemon` - Development server with hot reload
- `eslint` - Code linting
- `prettier` - Code formatting
- `@typescript-eslint/*` - TypeScript-specific linting

---

## Risk Mitigation

### Risk: Devin API quota or rate limits
**Mitigation**: Implement retry logic with exponential backoff, queue sessions if needed

### Risk: GitHub webhook delivery failures
**Mitigation**: Add webhook signature verification, log all incoming events, implement retry endpoint

### Risk: Devin session failures
**Mitigation**: Comprehensive error handling, issue comments with failure details, fallback to manual intervention

### Risk: Time constraints
**Mitigation**: Focus on working end-to-end demo over polish, use simple solutions for observability, limit to 2-3 issues initially
