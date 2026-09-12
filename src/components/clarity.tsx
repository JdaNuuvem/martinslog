import Script from 'next/script'

/**
 * Microsoft Clarity — gravação de sessão e mapa de calor.
 *
 * O identificador vem do ambiente, e não escrito aqui, por um motivo prático:
 * sem isso, toda execução local e toda rodada de teste mandaria sessão para o
 * mesmo projeto, e as métricas passariam a misturar quem compra com quem
 * desenvolve. Ausente a variável, o script simplesmente não entra na página.
 *
 * NÃO usa o prefixo `NEXT_PUBLIC_`, de propósito. Esse prefixo faz o Next.js
 * SUBSTITUIR a leitura pelo valor literal durante o build — então mudar a
 * variável no servidor não teria efeito nenhum sem reconstruir a imagem, e uma
 * variável criada depois do build fica valendo `undefined` para sempre.
 *
 * Este é um componente de servidor, então a leitura acontece na renderização e
 * uma variável comum resolve. O identificador acaba no HTML de qualquer forma,
 * o que é esperado: ele é público por natureza.
 *
 * `afterInteractive` deixa a página terminar de montar antes de carregar o
 * script: análise de comportamento não pode competir com o que o visitante
 * veio fazer.
 */
export function Clarity() {
  const id = process.env.CLARITY_ID

  if (!id) return null

  return (
    <Script id="clarity" strategy="afterInteractive">
      {`(function(c,l,a,r,i,t,y){
        c[a]=c[a]||function(){(c[a].q=c[a].q||[]).push(arguments)};
        t=l.createElement(r);t.async=1;t.src="https://www.clarity.ms/tag/"+i;
        y=l.getElementsByTagName(r)[0];y.parentNode.insertBefore(t,y);
      })(window, document, "clarity", "script", ${JSON.stringify(id)});`}
    </Script>
  )
}
