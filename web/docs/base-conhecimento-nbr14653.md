# Base de Conhecimento — Motor de Avaliação NBR 14.653 (ValoryTrue)

Este documento descreve a engenharia de regras aplicada pelos módulos **Empresa Avaliadora** (`api/analyze.ts` + `src/lib/avaliacao-types.ts`) e **AVM Cliente Final** (`api/avm.ts`), que seguem a metodologia da ABNT NBR 14.653 (partes 1 e 2 — Avaliação de Imóveis). É a referência usada tanto para orientar os prompts enviados à IA quanto para o cálculo determinístico e a busca de amostras feitos no servidor.

> A Reavaliação de Carteiras não segue este rito completo — é um fluxo em lote separado.

## Princípio central: amostras são SEMPRE reais, nunca inventadas

Esta é a regra mais importante do sistema, reforçada em todas as passadas de IA e em várias camadas de checagem determinística no servidor: **nenhuma amostra é fictícia ou simulada**. Toda amostra usada no laudo vem de um anúncio real, encontrado por busca de verdade na internet, com endereço, preço e link verificáveis. Se não houver amostras reais suficientes, o sistema **não inventa** — ele reporta honestamente que os dados são insuficientes (`dadosInsuficientes: true`) e explica o motivo, em vez de fabricar uma amostra para "completar a cota".

## Pipeline de 4 passadas (Empresa Avaliadora e AVM Cliente Final)

Cada passada é uma chamada HTTP separada porque o ambiente de execução (Vercel Edge Function) tem um limite rígido de **25 segundos por requisição individual** — não configurável nesse plano. Em vez de uma única chamada gigante (que estouraria o limite), o trabalho é dividido em passadas menores encadeadas pelo navegador.

1. **Busca de amostras reais (`api/find-amostras.ts`)** — passada dedicada, só para achar amostras. Roda **antes** da geração do laudo, porque a busca real precisa de tempo de verdade (uma única chamada de geração + busca no mesmo request historicamente deixava só ~4s pra busca, tempo real demais insuficiente). Ver seção "Busca de amostras reais" abaixo para os detalhes.
2. **Geração (`api/analyze.ts`)** — gera o rascunho completo da avaliação a partir dos dados do vistoriador, fotos, documentos, e da lista de amostras reais já encontrada na passada 1. Nunca faz busca própria quando já recebe a lista pronta.
3. **Auditoria (`api/analyze-verify.ts`)** — atua como um segundo avaliador/auditor externo, revisando cada campo com espírito crítico (consistência interna, plausibilidade técnica, aderência à NBR). Não tem acesso a busca própria — só pode remover amostras que pareçam inválidas, nunca substituir por outra.
4. **Confirmação final (`api/analyze-confirm.ts`)** — compara o valor do laudo contra uma pesquisa real de preço médio da região (busca separada, ver `api/_lib/preco-mercado.ts`), faz uma checagem de completude (nenhum campo vazio/genérico) e faz uma **última verificação de que os links das amostras ainda estão no ar** antes de entregar (os links já foram checados na passada 1, mas anúncios saem do ar rápido — essa recheck final reduz a janela de tempo em que isso pode acontecer). É aqui que a quota do usuário é consumida (uma vez só, no final, se tudo correr bem).

A UI mostra as 4 fases separadamente. Testado em produção: a passada de busca sozinha pode levar de poucos segundos a ~100s (ver abaixo), e as passadas 2-4 juntas costumam levar mais **~40-50 segundos**.

## Busca de amostras reais

### Fonte da busca

A busca usa uma **API de busca dedicada** (não mais a IA decidindo sozinha quanto buscar):

1. **Brave Search API** (prioridade, `BRAVE_SEARCH_API_KEY`) — consulta exata mandada pelo servidor, com `site:` dos portais imobiliários direto na query, resultado estruturado (URL + título + trecho) sem intermediário de IA.
2. **Google Custom Search API** (alternativa, `GOOGLE_CUSTOM_SEARCH_API_KEY` + `GOOGLE_CUSTOM_SEARCH_CX`) — usada só se a Brave não estiver configurada.
3. **Grounding do Gemini** (`google_search` tool) — último recurso, usado só se nenhuma das duas APIs dedicadas estiver configurada. Menos confiável: a mesma consulta pode retornar de 0 a 10 candidatos em chamadas diferentes, porque é a IA (não uma API de busca determinística) quem decide quanto buscar.

Portais buscados: Zap Imóveis, Viva Real, QuintoAndar, OLX Imóveis, Imovelweb, Attria, Chaves na Mão.

### Filtros de qualidade aplicados a cada candidato (`api/_lib/real-comparaveis.ts`)

Um resultado de busca só vira amostra candidata se passar por **todos** estes filtros:

- **Endereço restrito a rua + número** — a extração é deliberadamente estreita (só captura o nome da rua até o primeiro separador, mais o número do imóvel logo em seguida). Bairro, cidade, nome de condomínio e preço nunca são capturados junto, porque isso quebrava a geocodificação (ex.: "Avenida X, 2245, Condomínio Y" não geocodifica).
- **Preço obrigatório** — só é aceito como candidato um resultado onde um preço real (`R$ ...`) foi encontrado no mesmo trecho. Isso é o que distingue um anúncio real de uma unidade específica de uma página institucional do condomínio (que não tem preço de venda de nenhuma unidade).
- **Página institucional excluída por padrão de URL** — URLs contendo `/condominio/`, `/empreendimento/` ou `/lancamento/` no caminho são rejeitadas (são páginas de visão geral do prédio, não anúncio de uma unidade).
- **Página de categoria/listagem excluída** — um anúncio de unidade específica sempre tem algum número na URL (ID do anúncio, número do endereço, preço); uma página de categoria/listagem genérica, quase nunca. URLs sem nenhum dígito são rejeitadas.
- **Teto e piso de R$/m² absoluto** — descarta preços claramente implausíveis para qualquer região do Brasil (abaixo de R$800/m² ou acima de R$60.000/m²).
- **Filtro de outlier relativo ao próprio lote de busca** — compara cada candidato aos outros candidatos da mesma busca (por R$/m² quando há área, ou por preço absoluto quando não há). Um preço muito distante da mediana do próprio grupo é mais provavelmente um erro de extração (ex.: pegou o valor de entrada do financiamento em vez do preço total) do que uma pechincha real.
- **Distância real ≤ 500m** — cada candidato é geocodificado de verdade (Nominatim) e a distância até o imóvel avaliando é calculada por haversine; um raio maior "só na aparência" (endereço parece perto mas geocodifica mais longe) é rejeitado.
- **Link no ar (checado duas vezes)** — verificado na busca inicial (rejeita só 404/410 — "página não encontrada" — porque muitos portais bloqueiam automaticamente checagens automatizadas com 403/429, o que não significa que a página está morta) e verificado **de novo** na passada 4, bem antes da entrega do laudo.

### Quantidade-alvo e nova tentativa automática

- **Mínimo exigido: 5 amostras reais.** Abaixo disso, `dadosInsuficientes` é `true`.
- **Alvo de busca: até 8** (dá margem contra amostras que sejam descartadas depois por link morto ou filtro).
- Se a primeira rodada de busca não encontrar o suficiente, o sistema **tenta de novo automaticamente** — até 10 rodadas de paginação dentro de uma única chamada (Brave/Google), e até 4 chamadas separadas encadeadas pelo navegador (cada uma uma nova invocação do Edge Function, com seu próprio limite de 25s), para buscar por até ~100 segundos no total antes de desistir. As coordenadas do imóvel avaliando são reaproveitadas entre as chamadas encadeadas (evita geocodificar o mesmo endereço repetidas vezes).
- Nunca inventa uma amostra para completar a cota — preferimos entregar 2 amostras reais a inventar uma 3ª.

### Preço da amostra

O `valorAnunciado` de cada amostra é o **preço real extraído do próprio anúncio** — nunca uma estimativa da IA. `valorUnitario` é um cálculo direto (`valorAnunciado / areaM2`), não uma estimativa. Nas passadas de auditoria e confirmação, o endereço, a URL, a distância e o preço de uma amostra real são **imutáveis** — só podem ser removidas (se inválidas), nunca reescritas ou substituídas.

## Quando não há amostras suficientes (`dadosInsuficientes`)

Quando menos de 5 amostras reais sobrevivem a todos os filtros, o laudo é entregue mesmo assim, mas:

- `dadosInsuficientes` é `true` e `dadosInsuficientesMotivo` explica objetivamente quantas amostras foram encontradas e por quê isso é insuficiente.
- O valor de mercado **nunca fica em R$ 0** — na ausência de amostras suficientes, o valor é estimado a partir da pesquisa real de preço médio da região (passada 4) ou do conhecimento geral de mercado da IA, sempre sinalizado como uma estimativa aproximada de baixa confiabilidade.
- A interface mostra um aviso destacado ("Amostras reais insuficientes") tanto na tela do analista quanto no laudo em PDF.

## Pipeline de 12 módulos do laudo (Empresa Avaliadora)

1. **Identificação do imóvel** — endereço, CEP, número, complemento, bairro, cidade, UF (vindos do vistoriador via Fase 1).
2. **Tipologia** — classificação em uma das 13 categorias (`TIPOS_IMOVEL_NBR`): Terreno/lote urbano, Casa residencial, Apartamento, Sobrado, Imóvel comercial, Sala/conjunto comercial, Galpão, Loja, Prédio comercial, Imóvel industrial, Imóvel rural, Empreendimento imobiliário, Outros. Para Apartamento (e Sala/conjunto comercial), o formulário pede **área privativa** em vez de área construída, e **área construída total do condomínio** em vez de área do terreno (apartamento não tem terreno próprio).
3. **Finalidade** — `Valor de mercado` (estimativa do valor provável de negociação) ou `Valor de garantia` (voltada à concessão de crédito).
4. **Caracterização do avaliando** — padrão construtivo, estado de conservação, patologias, entorno, zoneamento, topografia, testada, posição no lote, infraestrutura urbana, ocupação e uso.
5. **Pesquisa de mercado** — ver seção "Busca de amostras reais" acima.
6. **Seleção das amostras** — amostras inadequadas são excluídas do tratamento e listadas com o motivo em `tratamentoEstatistico.amostrasExcluidas`.
7. **Escolha do método** — normalmente o Método Comparativo Direto de Dados de Mercado com tratamento por fatores de homogeneização, com justificativa explícita baseada na quantidade/qualidade das amostras.
8. **Homogeneização** — cada amostra recebe exatamente 4 fatores (Localização, Padrão construtivo, Conservação, Oferta), cada um com valor (coeficiente), origem, justificativa, campo de aplicação e abrangência regional/temporal. Os coeficientes não podem ficar todos em exatamente 1,00 ao mesmo tempo — isso denunciaria que nenhuma diferenciação real foi feita entre as amostras.
9. **Tratamento estatístico** — média, mediana, mínimo, máximo, coeficiente de variação e amplitude, calculados sobre os valores unitários homogeneizados — **sempre recalculado no servidor**, nunca aceito da IA.
10. **Grau de Fundamentação** — ver tabela abaixo.
11. **Grau de Precisão** — ver tabela abaixo.
12. **Valor final e laudo** — valor unitário, valor total, intervalo, valor adotado (com justificativa) e uma descrição narrativa do laudo em estilo técnico profissional.

## Banco de dados de amostras (schema `Amostra`)

| Campo | Descrição |
|---|---|
| id | Identificador da amostra (ex. "A01") |
| fonte | Nome do site de onde veio (extraído do domínio da URL) |
| data | Data da busca (sempre a data real de hoje, nunca uma data antiga) |
| endereco | Rua + número (extração restrita, ver acima) |
| tipologia | Tipologia do imóvel comparável |
| areaM2 | Área em m² (quando disponível no anúncio) |
| valorAnunciado | **Preço real do anúncio** — nunca uma estimativa |
| valorUnitario | valorAnunciado / areaM2 — cálculo direto |
| dormitorios, suites, banheiros, vagas | Características físicas |
| padrao, conservacao, idadeAnos | Padrão construtivo, estado de conservação, idade |
| distanciaM | Distância real (haversine), ≤500m — imutável |
| evidencia | Nota citando a fonte do anúncio |
| url | Link real do anúncio — **sempre presente**, verificado no ar duas vezes |
| fatoresAplicados | Array de `FatorHomogeneizacao` |
| valorUnitarioHomogeneizado | valorUnitario × produto dos fatores — recalculado no servidor, nunca aceito da IA |

Cada `FatorHomogeneizacao` tem: `fator`, `valor` (coeficiente), `origem`, `justificativa`, `campoAplicacao`, `abrangenciaRegional`, `abrangenciaTemporal`.

## Grau de Fundamentação (tratamento por fatores)

O grau final é o **mínimo entre os 4 itens** — a regra da norma é que o laudo vale pelo item mais fraco.

| Item | Grau I | Grau II | Grau III |
|---|---|---|---|
| 1. Caracterização do avaliando | Situação paradigma | Fatores utilizados identificados | Todos os fatores relevantes analisados |
| 2. Dados efetivamente utilizados | 3+ amostras | 5+ amostras | 12+ amostras |
| 3. Identificação dos dados | Características dos fatores | Características analisadas | Características + fotos + observações |
| 4. Intervalo admissível dos fatores | 0,40 – 2,50 | 0,50 – 2,00 | 0,80 – 1,25 |

Regras de cálculo determinístico aplicadas no servidor (`api/_lib/nbr-recompute.ts`):
- **Item 2** é contado a partir do `amostras.length` real (após todos os filtros) — nunca aceito por autodeclaração.
- **Item 4** é calculado a partir da razão máx/mín de todos os coeficientes (`fatoresAplicados[].valor`) realmente usados nas amostras.
- **Item 3** é rebaixado para no máximo Grau II se nenhuma foto foi anexada pelo vistoriador na Fase 1.
- O grau final é `min(item1, item2, item3, item4)`.

## Grau de Precisão

Baseado na amplitude do intervalo de confiança de 80% em torno da estimativa pontual:

```
amplitude (%) = |limiteSuperior - limiteInferior| / estimativaPontual × 100
```

| Amplitude | Grau |
|---|---|
| ≤ 30% | III |
| ≤ 40% | II |
| ≤ 50% (ou mais, como piso técnico) | I |

Calculado 100% no servidor a partir da estimativa e dos limites informados pela IA — a classificação da IA nunca é aceita diretamente.

## Divergências (vistoria × documentação)

Só é gerada uma divergência quando: (1) um documento (matrícula/IPTU) foi de fato anexado, (2) ele afirma **explicitamente e com clareza** um valor de área diferente do informado na vistoria, e (3) a diferença real é **maior que 5%**. A IA é instruída a nunca inventar ou "ler nas entrelinhas" um valor de documento que não esteja claro, e a não reportar diferenças pequenas (≤5%, tipicamente arredondamento entre área privativa/total). Na dúvida, o padrão é não reportar.

## Documentação e fotos analisadas (`documentosAnalisados`)

Todo arquivo (foto ou documento) anexado na vistoria precisa ter uma entrada correspondente em `documentosAnalisados`, com um resumo do que aquele arquivo mostra — sem exceção. As passadas 3 e 4 fazem uma checagem cruzada: se algum arquivo anexado não tiver entrada, ela é adicionada antes da entrega. Aparece como uma seção própria no laudo em PDF e no painel do analista.

## Valor final

- `valorUnitario` = média dos valores unitários homogeneizados das amostras reais — **ancorado matematicamente no servidor**, nunca um número solto que a IA declara à parte.
- `valorTotal` = `valorUnitario × areaAvalianda` — recalculado no servidor.
- `intervaloMin`/`intervaloMax` refletem a faixa do parecer, derivada do mínimo/máximo das amostras.
- `valorAdotado` é o valor final de fato adotado, com justificativa (normalmente igual ao valor de mercado recalculado).
- Confirmado na passada 4 contra uma pesquisa real de preço médio de m² da região (Zap, Viva Real, QuintoAndar, Proprietário Direto, Imovelweb) — se o valor do laudo destoar muito dessa pesquisa e não houver amostras reais suficientes sustentando o número, o valor é ajustado pra ficar dentro da faixa real encontrada.
- **Nunca fica em R$ 0**, mesmo no cenário de `dadosInsuficientes` — há uma rede de segurança determinística no servidor que usa a pesquisa de preço médio da região como base se a IA deixar o valor vazio.

## Descrição do laudo

Parágrafo narrativo único, gerado pela IA em estilo técnico profissional, cobrindo tipo de uso, tipologia, localização, áreas, padrão construtivo, conservação e características relevantes da região — inserido na seção de conclusão do laudo em PDF.

## Estrutura do laudo final (PDF)

1. Identificação do imóvel
2. Tipologia
3. Finalidade da avaliação
4. Caracterização do avaliando
5. Diagnóstico de mercado e método
6. Amostras utilizadas (com fatores de homogeneização)
7. Tratamento estatístico
8. Grau de Fundamentação
9. Grau de Precisão
10. Valor de mercado / Valor de garantia
11. Memória de cálculo e fundamentação do parecer
12. Premissas e ressalvas (divergências entre vistoria e documentação)
13. Financiabilidade
14. Índice de Qualidade da Garantia (IQG)
15. Documentação e fotos analisadas
16. Conclusão

Quando `dadosInsuficientes` é `true`, um aviso destacado aparece logo no topo do laudo.

## Relatório Fotográfico e Documentação Anexada (PDF)

O laudo em PDF (gerado no navegador com `jsPDF` + `pdf-lib`) anexa de verdade os arquivos enviados na vistoria: uma seção "RELATÓRIO FOTOGRÁFICO" com cada foto e sua legenda, e uma seção "DOCUMENTAÇÃO ANEXADA" com os documentos enviados (se for PDF, as páginas reais são mescladas no laudo; se for uma foto do documento, é inserida como imagem; fotos em formato HEIC do iPhone são convertidas automaticamente). Como os arquivos ficam guardados de forma privada no servidor (Vercel Blob), existe um proxy autenticado (`api/blob-proxy.ts`) que busca esses arquivos na hora de montar o PDF, sem nunca expor a chave de acesso ao navegador. Qualquer anexo que não puder ser incluído (arquivo corrompido, formato não suportado) aparece como uma página explícita de "Anexo não incluído" com o motivo, em vez de simplesmente desaparecer.

## Revisão por chat (`api/revise.ts`)

O analista pode questionar o parecer ou uma amostra específica pelo chat. A IA decide se o argumento é tecnicamente válido; se for sobre uma amostra, ela só pode **remover** a amostra questionada (nunca substituir por uma inventada, já que essa passada não tem acesso a busca própria). Se a remoção derrubar o total abaixo de 5, `dadosInsuficientes` é recalculado automaticamente no servidor.

## Onde isso vive no código

- `src/lib/avaliacao-types.ts` — todos os tipos (`TIPOS_IMOVEL_NBR`, `Amostra`, `FatorHomogeneizacao`, `GrauFundamentacao`, `GrauPrecisao`, `ValorFinalNBR`, `AvaliacaoResultado`, incluindo `dadosInsuficientes` e `documentosAnalisados`).
- `api/find-amostras.ts` — passada 1 dedicada à busca de amostras reais.
- `api/_lib/real-comparaveis.ts` — busca via Brave/Google/Gemini, todos os filtros de qualidade, geocodificação e distância real (Nominatim/haversine), verificação de link no ar, lógica de nova tentativa e paginação encadeada.
- `api/_lib/preco-mercado.ts` — pesquisa real de preço médio de m² da região, usada na passada 4.
- `api/analyze.ts` — passada 2: prompt (`SYSTEM_INSTRUCTION`) e montagem do request pro Gemini.
- `api/analyze-verify.ts` — passada 3: auditoria técnica.
- `api/analyze-confirm.ts` — passada 4: confirmação final, checagem de completude, recheck de links, consumo da quota.
- `api/_lib/nbr-recompute.ts` — recálculo determinístico (compartilhado pelas passadas 2, 3 e 4), incluindo `sanitizarUrlsAmostras` (nunca aceita uma URL que a IA não recebeu de uma busca real) e o cálculo determinístico de `dadosInsuficientes`.
- `api/_lib/nbr-schema.ts` — schema estrutural do Gemini (compartilhado pelas passadas 2, 3 e 4).
- `api/avm.ts` — mesmas regras de amostras reais aplicadas ao módulo AVM Cliente Final, que também usa a passada dedicada de busca (`api/find-amostras.ts`) desde que essa lacuna foi identificada e corrigida.
- `api/revise.ts` — revisão por chat.
- `src/components/wizard/fase1-vistoriador.tsx` — formulário com tipologia, finalidade e campos físicos/urbanos.
- `src/components/wizard/fase2-processando.tsx` — orquestra as 4 passadas no navegador, incluindo o encadeamento de múltiplas chamadas de busca.
- `src/components/wizard/fase3-analista.tsx` — revisão do laudo pelo analista (amostras, tratamento estatístico, graus, valor final, aviso de dados insuficientes).
- `src/components/wizard/fase5-laudo.tsx` — geração do laudo final em PDF.
- `src/lib/pdf.ts` — motor de geração de PDF (jsPDF para o texto + pdf-lib para anexar fotos/documentos).
- `api/blob-proxy.ts` — proxy autenticado para o navegador conseguir buscar fotos/documentos privados na hora de montar o PDF.
