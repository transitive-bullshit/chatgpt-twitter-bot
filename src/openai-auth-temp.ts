import { ChatGPTAPI } from 'chatgpt'

import './config'
import { getSessionTokenForOpenAIAccountUsingPuppeteer } from './openai-auth-puppeteer'

/**
 * TODO
 */
async function main() {
  const email = ''
  const password = ''

  const clearanceToken =
    'I.Q8ay3nxBoffvNTVlxkHxgiXo9fEWvxpjzQKRHLKwc-1670796732-0-160'
  const sessionToken =
    'eyJhbGciOiJkaXIiLCJlbmMiOiJBMjU2R0NNIn0..EwqLVGv4-m-4Ll1H.up7e_cQ5Vkg2SJGmWktEppyZPEqbdnm4jep6S15T1LY9kMd_-xyiiSqGqz4SdTsmLt1N2g2qQGkdUjJPvOdjoaJd1NMPr1f9d0qhmZURvQ_9Al5hE4YsjeNunsTPIfdXLj8iXJycJHPiGJB9L4PX_bFlrMY__Wv-HxgB_i5bnIhysScN-T7TyCEQQLzk_k_NQrpt5TEn8te9IcmSfiZCa_2Mw6pBRocGk-KHk1kQt09utWOdvJ_Ggo3nsfOvejkBYHu0-Y9mxRf4fCuA9DC0HETafdeJ8ug6XhzzAhX6wHx4gI1g-xhZprpiYUD9D1V4JtGl1oeezrAq0ly7Dn9QXMflSSvsav1Mk4l-fdvG4SeIi6vYzjTWY9puvHXTZLqdxeiDcp61abzZqQFXqSp9VajgXrGX9JQQQLQpuTDPwxIgGtZRZhSJ09i_E4I5RS4bLfrN4RLPpcpTcmZ3jhiuc6jTnmJlFDB8c8mXEjbnMC47iRzd3kgp0S92A79OFGF1RUUI6lNhD7KMlrWVOCtGd0xXwRpVP0-GSGAT6rUd73pMe2ROjfZgGv0rnWU7LfqIBgc_LAaaIKNaRJjPstI_9vHTc4v7mgF1jcABl6Z-cSrFD70QlDTA8Y7j1uFWYJ2EJuYRLs0WL5j2CDJF8-HZNQPVv436BOpsvb8igMRDVBo5PXSIxc-EU_RHJiOMNAE8VjdYF3Meb6PYQLTfei_14Hm2RXjInKNBFg12Y_gIN7sMcAaMlq5IhStrgbqT6r7gmVFvgfv_CadSZ-uvXeUkNRQ-nHFizIhNScZ-83pkBrJ1r5LDVUkQip4GxYQ7N4htMYU3EHteg-StMxwkZXXoLsWG7bNnSIhRQDSGWe2Nk0Cx6oJ6X56hGkl8_nU7FnM6zGr_H7SEzO2_X1-HxDhTbvzcBj1F-q3bjstuxCRICdwKaKvukFoa3bY3pNVSnY_zJIYLAhLfUCnR1v46pqebHLjNphmXI3u3eRtKZ9AWxR-_CbgAJ0prcWc4e5X8VlCp3QKA5bBp3npoDCMgW_CJ47HK_nym4t1-1RscxE2jyct1lCeFAPKSEhBigp_SpQOuJbxvaXOV2uyMNtAnUR-BOvGQFuBj-z5WfFAmeo65TR3XdSNSlOBS_SJzAaXBZK-YxstvmQmLlJlsWlaxDG4h0P0H0DnbRGLnjbI_n817jf3LAzrj8qrwaPxZG-pn1PWRoFpB0-gQDE92jpVEy3kLEbbLAxB_ra-1fBtHdZctV4ffDs57OccVYiTSmGvUwpUSv8SjcmRAshaFLt6itgtVLE7Bh9ZGdvfv--ZT11M-3MXCDED6awuF9K048px9QgjTVhFlyrpGvp0sfwgTby5T-P8kI4eO3al8Zdks39p9lSA6-rqmfWwbDmcn-dKhOjhG9-b04nBu7QojSZG4dC2VFs_49I6HwDs7K3594o4cnSIlVpIyrqpfxD8gW3UNyrcFBBVyiUc-0_KSyDP9yCD2dHBurmVm94GFhW_NUmled6KQqqCxiPymPF-Jc2wfL3uy8T8SWClTdkIhpTvso_u0DdhVtL4BvN9so-k3TDKWYdSJVJNh-h6gtsMLH1D27JqCE0xYXYpOu9CsGznEPkuJpK73w9gEqtF57POtZvYI-hjbvdOZ9G-efOIyKHJxrUx5CTO1Rz7xNgFFqIFxirOgaaKhb87iSRTL4Cpq9htflL0zPPgIBYJc5j9ceA2WfKUrFdZFeRpz3jEyhxUct1J-RAoxOlzakvzw3fFp8kFWHODZcLbtN1NMV-Eui9ZHusCcHCHI0rdl4GQSkq8WoftjUfgzkSEF0hBV1iQoZtCVrSF0rgNev2x8rFcRILDQMtza5OZys0jrhndaGHr5qSucx_945pCFT8EjTPQO_GcLtRZvHtEvUXNlUoBqkm_p7ocptaYaJRRuxcxSPzTZR5yw0bwSYe5eNC2C7W8EQz_1nnpnw4Oj14Aj_pt-NmPKIMhYfP-A07hQFsx-rMS4IFQSJ9KJQmSTqEICmURNQa8iRFNsloGU7-qTH8db8R6yJAon0AZ34rAKuMwrEdNxNlDxztlDWPUtko7mwz2aKHgXT8frqMa4Ir11mjc2nL3nIwLBx3OgsZfZlGBF_UHYX9Sfcjj1S5kmN0kPT-IU025ixqL5xLbN4qQKb44i1I9HvsaSmlIahQTW8LsemcvqdolGArY4sOQTpKTOmzatJu44YUD9gILxRidgTLKzRsIgTqiYJ94PAFCGPJ7_Ehuq35BIGb5D-KmQHQD_REAhiTKZGCEclt8AXwIhnitaQAmeQ_HP30z7RRCNNi5Y39gzcAAvxyyudkDiv6IRyZMZcY6lCBBdQyBhuTivu4FgAoHW.3iXUzGduiKCcsVMmcEXxMg'

  const chatgpt = new ChatGPTAPI({
    sessionToken,
    clearanceToken
  })

  console.log('ensureAuth')
  await chatgpt.ensureAuth()
  console.log('authed!')

  const response = await chatgpt.sendMessage('hello little AI friend')
  console.log(response)

  // const token = await getSessionTokenForOpenAIAccountUsingPuppeteer({
  //   email,
  //   password
  // })
  // console.log(token)
}

main()
  .then(() => {
    process.exit(0)
  })
  .catch((err) => {
    console.error('error', err)
    console.error(err?.response?.headers)
    process.exit(1)
  })
