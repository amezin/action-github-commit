import fs from 'fs';

import * as core from '@actions/core';
import {getExecOutput} from '@actions/exec';
import * as github from '@actions/github';

async function run(): Promise<void> {
  try {
    const {owner, repo} = github.context.repo;
    const token = core.getInput('github-token');
    const message = core.getInput('message') || 'Default commit message';
    const branchName = process.env.GITHUB_HEAD_REF || process.env.GITHUB_REF;

    if (!token) {
      core.setFailed('GitHub token not found');
      return;
    }

    const octokit = github.getOctokit(token); // might fail with an auth error?

    // Find updated file contents using the `git` cli.
    // ===============================================
    const lsFiles = await getExecOutput('git', ['ls-files', '-om', '--exclude-standard'], {
      failOnStderr: true
    });

    const files = lsFiles.stdout.split('\n');
    const newContents = [];
    for (const path of files) {
      if (!path.trim())
        {continue}
      const fileContent = fs.readFileSync(path);
      newContents.push({
        path,
        mode: '100644' as const,
        type: 'blob' as const,
        content: Buffer.from(fileContent).toString(),
      })
    }

    if (!newContents.length) {
      return;  // This action is a no-op if there are no changes.
    }

    const { stdout: commit_sha } = await getExecOutput('git', ['rev-parse', 'HEAD'], {
      failOnStderr: true
    });

    const { stdout: base_tree } = await getExecOutput('git', ['rev-parse', `${commit_sha}^{tree}`], {
      failOnStderr: true
    });

    // Do a dance with the API.
    // ========================
    // Docs at docs.github.com/en/rest/git/trees but tbh I just asked ChatGPT
    // and then made it as terse as I could. :shrug:

    const g = octokit.rest.git;
    const ref = `heads/${branchName}`;  // slight discrepancy w/ updateRef docs here
    const {data: {sha: tree}} = await g.createTree({owner, repo, base_tree, tree: newContents,});
    const {data: {sha}} = await g.createCommit({owner, repo, message, tree, parents: [commit_sha]});
    await g.updateRef({owner, repo, ref, sha,});

  } catch (error: unknown) {
    if (error instanceof Error) {
      core.error(error.stack || '');
      core.setFailed(error.message);
    } else {
      console.log(error);
      core.setFailed('catastrophe');
    }
  }
}

run();
