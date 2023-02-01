import { HuggingFace } from 'huggingface'
import pMemoize from 'p-memoize'

const hf = new HuggingFace(process.env.HUGGING_FACE_API_KEY)

export const detectLanguage = pMemoize(detectLanguageImpl)

async function detectLanguageImpl(text: string) {
  const model = 'papluca/xlm-roberta-base-language-detection'
  return hf.textClassification(
    {
      model,
      inputs: text
    },
    {
      use_cache: true
    }
  )
}
