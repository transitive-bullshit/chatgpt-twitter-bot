import { type ExecaReturnBase, execaCommand } from 'execa'

/**
 * Generates a fresh session token for an OpenAI account based on email +
 * password. Under the hood, it uses a Python TLS-based solution to bypass
 * OpenAI and Auth0's authentication protections.
 */
export async function generateAccessTokenForOpenAIAccount({
  email,
  password,
  timeoutMs = 2 * 60 * 1000
}: {
  email: string
  password: string
  timeoutMs?: number
}): Promise<string> {
  const command = `poetry run python3 bin/openai-auth.py ${email} ${password}`
  console.log(command)

  let res: ExecaReturnBase<string>
  try {
    res = await execaCommand(command, {
      shell: true,
      timeout: timeoutMs
    })
  } catch (err: any) {
    const stderr: string = err.stderr?.toLowerCase()
    if (stderr?.includes('wrong email or password')) {
      throw new Error(`Wrong email or password for OpenAI account "${email}"`)
    } else {
      throw err
    }
  }

  console.log(res.stdout)
  console.log(res.stderr)

  if (res.exitCode !== 0) {
    console.error(res.stderr)
    throw new Error(
      `openai-auty.py returned exit code ${res.exitCode} for OpenAI account ${email}`
    )
  }

  const accessToken = res.stdout?.trim()
  if (!accessToken) {
    console.error(res.stderr)
    throw new Error(
      `openai-auty.py returned empty session token for OpenAI account ${email}`
    )
  }

  return accessToken
}
