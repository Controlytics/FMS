# API Reference: Help

See the interactive Swagger UI at `/docs` for complete endpoint documentation with request/response schemas.

## Endpoints
| Method | Path | Description |
|--------|------|-------------|
| GET | /api/help/articles | List help articles (filtered by published status) |
| GET | /api/help/articles/:contextKey | Get article by context key |
| POST | /api/help/articles | Create article (HELP_MANAGE permission) |
| PUT | /api/help/articles/:id | Update article (creates new version) |
| GET | /api/help/articles/:id/versions | Version history |
| DELETE | /api/help/articles/:id | Soft delete (HELP_MANAGE permission) |

## Features
- Context-sensitive help via contextKey mapping to pages/sections
- Versioned articles (every edit creates a HelpArticleVersion)
- Markdown content with rendered preview
- 28+ default help articles seeded at setup
- Publish/unpublish toggle
