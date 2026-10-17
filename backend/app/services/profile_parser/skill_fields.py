"""个人资料技能字段的拆分、别名规范化和等级解析。"""

import re

from .normalization import _clean_line
from .skill_constants import _SKILL_LEADING_LEVEL_RE, _SKILL_LEVEL_RE


def _split_tokens(value: str) -> list[str]:
    # 斜杠通常是分隔符，但 CI/CD 是一个完整技能；先保护它，避免被拆成
    # 两个无意义的 “CI”/“CD” 标签。
    protected = re.sub(r"\bCI\s*/\s*CD\b", "CI_CD", value, flags=re.IGNORECASE)
    return [
        token.strip().replace("CI_CD", "CI/CD").replace("ci_cd", "CI/CD")
        for token in re.split(
            r"[,，、/|｜;；&\n]+|(?<!\s)\s++(?:and|以及|及)\s++",
            protected,
            flags=re.IGNORECASE,
        )
        if token.strip()
    ]


def _normalize_skill_name(value: str) -> str:
    """保留用户的自定义技能，同时统一高置信度的常见技术写法。"""
    compact = re.sub(r"[\s._-]+", "", value).casefold()
    if re.fullmatch(r"python3\d{0,2}", compact):
        return "Python"
    if re.fullmatch(r"java(?:8|11|17|21)", compact):
        return "Java"
    if re.fullmatch(r"(?:react|vue)\d{1,2}", compact):
        return "React" if compact.startswith("react") else "Vue"
    if re.fullmatch(r"ci/cd(?:pipelines?)?", compact):
        return "CI/CD"
    aliases = {
        "py": "Python",
        "python3": "Python",
        "python语言": "Python",
        "golang": "Go",
        "go语言": "Go",
        "cpp": "C++",
        "c++语言": "C++",
        "js": "JavaScript",
        "javascript": "JavaScript",
        "javascript语言": "JavaScript",
        "typescript": "TypeScript",
        "typescript语言": "TypeScript",
        "reactjs": "React",
        "react16": "React",
        "react17": "React",
        "react18": "React",
        "reactnative": "React Native",
        "vuejs": "Vue",
        "vue2": "Vue",
        "vue3": "Vue",
        "angularjs": "Angular",
        "nodejs": "Node.js",
        "nextjs": "Next.js",
        "sveltejs": "Svelte",
        "tailwindcss": "Tailwind CSS",
        "html5": "HTML5",
        "html": "HTML5",
        "css3": "CSS3",
        "css": "CSS3",
        "springboot": "Spring Boot",
        "springcloud": "Spring Cloud",
        "mybatis": "MyBatis",
        "django": "Django",
        "flask": "Flask",
        "expressjs": "Express",
        "mysql数据库": "MySQL",
        "mysql8": "MySQL",
        "mysql": "MySQL",
        "postgres": "PostgreSQL",
        "postgresql数据库": "PostgreSQL",
        "postgresql": "PostgreSQL",
        "sqlite3": "SQLite",
        "sqlite": "SQLite",
        "mongodb": "MongoDB",
        "mongo": "MongoDB",
        "rabbitmq": "RabbitMQ",
        "apachekafka": "Kafka",
        "kafka": "Kafka",
        "redis": "Redis",
        "elasticsearch": "Elasticsearch",
        "websocket": "WebSocket",
        "grpc": "gRPC",
        "k8s": "Kubernetes",
        "kubernetes": "Kubernetes",
        "vue": "Vue",
        "react": "React",
        "fastapi": "FastAPI",
        "pytorch": "PyTorch",
        "torch": "PyTorch",
        "tensorflow": "TensorFlow",
        "tf": "TensorFlow",
        "opencv": "OpenCV",
        "cv2": "OpenCV",
        "sklearn": "Scikit-learn",
        "scikitlearn": "Scikit-learn",
        "xgboost": "XGBoost",
        "机器学习": "机器学习",
        "深度学习": "深度学习",
        "自然语言处理": "自然语言处理",
        "nlp": "自然语言处理",
        "计算机视觉": "计算机视觉",
        "机器视觉": "计算机视觉",
        "cv": "计算机视觉",
        "大语言模型": "大模型",
        "大型语言模型": "大模型",
        "llm": "大模型",
        "检索增强生成": "RAG",
        "检索增强": "RAG",
        "rag": "RAG",
        "智能体": "Agent",
        "aigc": "AIGC",
        "生成式人工智能": "AIGC",
        "生成式ai": "AIGC",
        "docker": "Docker",
        "linux": "Linux",
        "git": "Git",
        "terraform": "Terraform",
        "microservices": "微服务",
        "微服务架构": "微服务",
        "distributedsystems": "分布式",
        "分布式系统": "分布式",
        "restapi": "RESTful",
        "restfulapi": "RESTful",
        "csharp": "C#",
        "dotnet": ".NET",
        "net": ".NET",
        "sql": "SQL",
        "cicd": "CI/CD",
        "ci/cd": "CI/CD",
        "ci/cdpipelines": "CI/CD",
        "devops": "DevOps",
    }
    return aliases.get(compact, value.strip())


def _skill_name_and_level(token: str, inherited_level: str = "") -> tuple[str, str]:
    """支持括号、前后缀和破折号等技能等级表述。"""
    clean = token.strip().strip("-—–－:：")
    for suffix in ("等编程语言", "等开发语言", "等技术", "等工具", "等框架", "等"):
        if clean.endswith(suffix):
            clean = clean[: -len(suffix)].rstrip()
            break
    if not clean:
        return "", ""

    if clean.endswith((")", "）")):
        opening = max(clean.rfind("("), clean.rfind("（"))
        if opening > 0:
            level = clean[opening + 1 : -1].strip()
            if _SKILL_LEVEL_RE.fullmatch(level):
                return _normalize_skill_name(clean[:opening]), level
    trailing = re.search(_SKILL_LEVEL_RE.pattern.removeprefix("^"), clean, re.IGNORECASE)
    if trailing and trailing.start() > 0:
        prefix = clean[: trailing.start()]
        if prefix[-1].isspace() or prefix[-1] in "-—–－:：":
            return _normalize_skill_name(prefix.rstrip(" \t-—–－:：")), trailing.group(1)

    leading = _SKILL_LEADING_LEVEL_RE.match(clean)
    if leading:
        return _normalize_skill_name(leading.group("skills")), leading.group("level")
    return _normalize_skill_name(clean), inherited_level


def _parse_skills(lines: list[str]) -> list[dict[str, str]]:
    result: list[dict[str, str]] = []
    indices_by_name: dict[str, int] = {}
    for line in lines:
        clean = _clean_line(line)
        if not clean:
            continue
        label_match = re.match(r"^([^：:]{1,32}?)\s*+[:：]\s*+(.+)$", clean)
        label_key = label_match.group(1).casefold() if label_match else ""
        if label_match and any(
            term.casefold() in label_key
            for term in (
                "技能",
                "技术",
                "语言",
                "工具",
                "框架",
                "数据库",
                "中间件",
                "前端",
                "后端",
                "云原生",
                "人工智能",
                "机器学习",
                "自然语言",
                "计算机视觉",
                "计算机",
                "摄影",
                "设计",
                "办公",
                "大模型",
                "certification",
                "certifications",
                "technical",
                "tech",
                "technology",
                "expertise",
                "proficiencies",
                "programming",
                "language",
                "languages",
                "database",
                "framework",
                "frontend",
                "backend",
                "cloud",
                "tools",
            )
        ):
            clean = label_match.group(2)
        inherited_level = ""
        leading_level = _SKILL_LEADING_LEVEL_RE.match(clean)
        if leading_level:
            inherited_level = leading_level.group("level")
            clean = leading_level.group("skills")
        # 分类行里偶尔出现整句技能描述（如
        # 「摄影：熟练掌握相机的使用，能独自完成视频拍摄与剪辑工作」）——
        # 逗号只是句子停顿而不是技能列表分隔符，句子太长且没有顿号/斜杠这类
        # 列表分隔符时整条保留，拆开会产生「相机的使用」这类无意义碎片。
        long_sentence = (
            label_match is not None
            and len(clean) > 16
            and "、" not in clean
            and "/" not in clean
            and "|" not in clean
        )
        tokens = [clean] if long_sentence else _split_tokens(clean)
        for token in tokens:
            name, level = _skill_name_and_level(token, inherited_level)
            key = name.casefold()
            if not name or len(name) > 64:
                continue
            existing_index = indices_by_name.get(key)
            if existing_index is None:
                indices_by_name[key] = len(result)
                result.append({"name": name, "level": level})
            elif level and not result[existing_index]["level"]:
                # 同一技能在“技能清单”和“熟练程度”两处都出现时，保留更完整的等级。
                result[existing_index]["level"] = level
    return result
