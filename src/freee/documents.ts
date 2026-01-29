export const GQL = {
  currentTeam: /* GraphQL */ `
    query CurrentTeam {
      team {
        id
        name
      }
    }
  `,

  listWorkflows: /* GraphQL */ `
    query ListWorkflows(
      $first: Int!
      $after: String
      $where: WorkflowWhereInput
    ) {
      team {
        workflows(first: $first, after: $after, where: $where) {
          pageInfo {
            endCursor
            hasNextPage
          }
          nodes {
            id
            name
            triggerKind
            argumentKind
            executionKind
            viewerKind
            status
            order
            memberFilters {
              id
              memberFilterCriteria {
                criteria
              }
            }
            workflowScheduleSetting {
              referenceDateKind
              differenceDate
              time
            }
            tasks {
              id
              order
              actionName
              params
              application {
                id
                name
              }
            }
          }
        }
      }
    }
  `,

  createWorkflow: /* GraphQL */ `
    mutation CreateWorkflow($input: CreateWorkflowInput!) {
      createWorkflow(input: $input) {
        workflowEdge {
          node {
            id
            name
            triggerKind
            argumentKind
            executionKind
            viewerKind
            status
          }
        }
      }
    }
  `,

  updateWorkflow: /* GraphQL */ `
    mutation UpdateWorkflow($input: UpdateWorkflowInput!) {
      updateWorkflow(input: $input) {
        workflow {
          id
          name
          triggerKind
          argumentKind
          executionKind
          viewerKind
          status
        }
      }
    }
  `,

  updateWorkflowStatus: /* GraphQL */ `
    mutation UpdateWorkflowStatus($input: UpdateWorkflowStatusInput!) {
      updateWorkflowStatus(input: $input) {
        workflow {
          id
          status
        }
      }
    }
  `,

  updateWorkflowViewerKind: /* GraphQL */ `
    mutation UpdateWorkflowViewerKind($input: UpdateWorkflowViewerKindInput!) {
      updateWorkflowViewerKind(input: $input) {
        workflow {
          id
          viewerKind
        }
      }
    }
  `,

  updateWorkflowSchedule: /* GraphQL */ `
    mutation UpdateWorkflowSchedule($input: UpdateWorkflowScheduleInput!) {
      updateWorkflowSchedule(input: $input) {
        workflow {
          id
          triggerKind
          workflowScheduleSetting {
            referenceDateKind
            differenceDate
            time
          }
        }
      }
    }
  `,

  createWorkflowTask: /* GraphQL */ `
    mutation CreateWorkflowTask($input: CreateWorkflowTaskInput!) {
      createWorkflowTask(input: $input) {
        workflowTaskEdge {
          node {
            id
            order
            actionName
            params
            application {
              id
              name
            }
          }
        }
      }
    }
  `,

  updateWorkflowTask: /* GraphQL */ `
    mutation UpdateWorkflowTask($input: UpdateWorkflowTaskInput!) {
      updateWorkflowTask(input: $input) {
        workflowTask {
          id
          order
          actionName
          params
          application {
            id
            name
          }
        }
      }
    }
  `,

  deleteWorkflowTask: /* GraphQL */ `
    mutation DeleteWorkflowTask($input: DeleteWorkflowTaskInput!) {
      deleteWorkflowTask(input: $input) {
        workflowTask {
          id
        }
      }
    }
  `,

  reorderWorkflowTask: /* GraphQL */ `
    mutation ReorderWorkflowTask($input: ReorderWorkflowTaskInput!) {
      reorderWorkflowTask(input: $input) {
        workflowTask {
          id
          order
        }
      }
    }
  `,

  createMemberFilter: /* GraphQL */ `
    mutation CreateMemberFilter($input: CreateMemberFilterInput!) {
      createMemberFilter(input: $input) {
        memberFilterEdge {
          node {
            id
            memberFilterCriteria {
              criteria
            }
          }
        }
      }
    }
  `,

  updateMemberFilter: /* GraphQL */ `
    mutation UpdateMemberFilter($input: UpdateMemberFilterInput!) {
      updateMemberFilter(input: $input) {
        memberFilter {
          id
          memberFilterCriteria {
            criteria
          }
        }
      }
    }
  `,

  deleteMemberFilter: /* GraphQL */ `
    mutation DeleteMemberFilter($input: DeleteMemberFilterInput!) {
      deleteMemberFilter(input: $input) {
        clientMutationId
      }
    }
  `,

  updateWorkflowsOrder: /* GraphQL */ `
    mutation UpdateWorkflowsOrder($input: UpdateWorkflowsOrderInput!) {
      updateWorkflowsOrder(input: $input) {
        clientMutationId
      }
    }
  `,
} as const;
