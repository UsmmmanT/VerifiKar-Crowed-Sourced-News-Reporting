import json
import httpx
from app.core.config import settings
from typing import Dict, Any, List
from tenacity import (
    retry,
    stop_after_attempt,
    wait_exponential,
    retry_if_exception_type,
    before_sleep_log
)
import logging

logger = logging.getLogger(__name__)

# Ollama Configuration
OLLAMA_BASE_URL = settings.OLLAMA_BASE_URL
MODEL_NAME = settings.OLLAMA_MODEL_NAME

# --- 1. CATEGORIZATION PROMPT (Optimized for JSON Mode) ---
# We keep the EXACT category list and JSON keys you defined.
CATEGORIZATION_SYSTEM_PROMPT = """You are a text processing engine. Output only valid JSON.
Translate the input text to English and classify it into ONE category.

Category List (Choose exactly one):
Fire, Accident, Traffic, Crime, Protest, Disaster, Infrastructure, Outage, Health, Environment, Rescue, Weather, Politics, Social, Spam/Ad, Other

Instructions:
1. Translate text to English (keep location names original).
2. Remove emotional words.
3. Classify the event.

Output Format (JSON ONLY):
{
    "cleaned_text": "translated text here",
    "event_category": "CategoryName"
}"""


# --- 2. SUMMARIZATION PROMPT (Structure Enforced) ---
# Enforced strict "No chat" rules to ensure a clean string return.
SUMMARIZATION_TEMPLATE = """### Instruction:
Combine the following reports into ONE single summary paragraph (2-4 sentences).

Rules:
1. Combine similar details and keep location names exact.
2. Use simple English. NO lists. NO bullets.
3. Start writing IMMEDIATELY. Do NOT write conversational phrases.

DO NOT START WITH:
- "Sure, here is..."
- "Here is the summary..."
- "The summary is..."
- Any greeting or acknowledgment

START IMMEDIATELY WITH THE ACTUAL SUMMARY.

### Input Reports:
{reports}

### Response:
"""


# --- 3. COMPARISON PROMPT (Strict Output Matching) ---
# Adjusted to ensure it hits your specific "SAME" check or returns raw text.
COMPARISON_TEMPLATE = """### Instruction:
Compare the EXISTING POST and the NEW POST.

Rules:
1. If they describe the SAME incident with NO significant new info, output exactly: SAME
2. If the NEW POST has significant new details (casualties, spread, new location), output ONLY the new details (1-2 sentences).

Criteria for "SAME":
- Minor wording differences = SAME
- Same facts repeated = SAME

### EXISTING POST:
{existing_content}

### NEW POST:
{new_content}

### Response (Write ONLY "SAME" or the new details):
"""


# --- FUNCTIONS ---

@retry(
    retry=retry_if_exception_type((Exception,)),
    stop=stop_after_attempt(2),
    wait=wait_exponential(multiplier=1, min=2, max=10),
    before_sleep=before_sleep_log(logger, logging.WARNING),
    reraise=True
)
async def _call_ollama_with_retry(
    prompt: str, 
    system_prompt: str = None, 
    json_mode: bool = False
) -> str:
    """
    Wraps Ollama API calls. 
    """
    payload = {
        "model": MODEL_NAME,
        "stream": False,
        "options": {
            "temperature": 0.1,  # Low temp is critical for following formatting rules
            "top_p": 0.9,
            "stop": ["###", "Input:", "User:"] # Stop tokens prevent hallucinations
        }
    }

    if json_mode:
        payload["format"] = "json"
    
    # Structure the prompt based on mode
    if system_prompt:
        if json_mode:
            # For JSON mode, System prompt works best in the 'system' field
            payload["system"] = system_prompt
            payload["prompt"] = prompt
        else:
            # For text mode, we manually concatenate to control the flow
            payload["prompt"] = f"{system_prompt}\n\n{prompt}"
    else:
        payload["prompt"] = prompt

    async with httpx.AsyncClient(timeout=90.0) as client:
        response = await client.post(
            f"{OLLAMA_BASE_URL}/api/generate",
            json=payload
        )
        response.raise_for_status()
        result = response.json()
        return result["response"].strip()


async def clean_and_categorize_text(text: str) -> Dict[str, str] | None:
    text = text.strip()
    if not text:
        return None

    try:
        # We use json_mode=True to force the model to output the structure defined in CATEGORIZATION_SYSTEM_PROMPT
        cleaned_output = await _call_ollama_with_retry(
            prompt=f"Input Text: {text}",
            system_prompt=CATEGORIZATION_SYSTEM_PROMPT,
            json_mode=True
        )
        
        # Parse JSON
        result = json.loads(cleaned_output)
        
        # Validation to match your original constraints
        if not isinstance(result, dict) or "cleaned_text" not in result or "event_category" not in result:
            logger.error(f"Invalid JSON structure: {cleaned_output}")
            return None
        
        # Clean category name (handling edge cases like 'Fire - explosion')
        category = result.get('event_category', 'Other').strip()
        if " - " in category:
            category = category.split(" - ")[0].strip()
        result['event_category'] = category
            
        return result

    except json.JSONDecodeError as e:
        logger.error(f"JSON parsing error. Output was: {cleaned_output}", exc_info=True)
        return None
    except Exception as e:
        logger.error(f"Error in categorization: {e}", exc_info=True)
        logger.error(f"This usually means Ollama is not running or not responding. Check OLLAMA_BASE_URL={OLLAMA_BASE_URL} and OLLAMA_MODEL_NAME={MODEL_NAME}")
        return None


async def summarize_reports(reports: List[str]) -> str | None:
    if not reports:
        return "No summary available."

    try:
        # Inject reports into the template
        prompt_input = SUMMARIZATION_TEMPLATE.format(reports=str(reports))
        
        summary = await _call_ollama_with_retry(
            prompt=prompt_input,
            json_mode=False
        )
        
        # Cleanup: model may still add quotes or prefixes despite instructions
        summary = summary.strip('"').strip()
        
        # Remove common conversational prefixes (case-insensitive)
        prefixes_to_remove = [
            "sure, here is the summary you requested:",
            "sure, here is the summary:",
            "here is the summary you requested:",
            "here is the summary:",
            "the summary is:",
            "summary:",
        ]
        
        summary_lower = summary.lower()
        for prefix in prefixes_to_remove:
            if summary_lower.startswith(prefix):
                summary = summary[len(prefix):].strip()
                break
        
        # Remove leading newlines and extra whitespace
        summary = summary.strip()
            
        return summary

    except Exception as e:
        logger.error(f"Error in summarization: {e}", exc_info=True)
        return None


async def compare_post_content(existing_content: str, new_content: str) -> dict[str, Any]:
    try:
        prompt_input = COMPARISON_TEMPLATE.format(
            existing_content=existing_content, 
            new_content=new_content
        )
        
        result = await _call_ollama_with_retry(
            prompt=prompt_input,
            json_mode=False
        )
        
        result_clean = result.strip()
        
        # Handling the "SAME" check strictly as requested
        # We use .upper() to be safe, but the prompt instructs strict "SAME"
        if result_clean.upper() == "SAME" or result_clean.upper().strip('.') == "SAME":
            logger.info("Posts are SAME")
            return {
                "is_same": True,
                "new_details": None
            }
        else:
            # If not same, return the text as new details
            # Cleanup common chatty prefixes if they appear
            if result_clean.lower().startswith("new details:"):
                result_clean = result_clean.split(":", 1)[-1].strip()
                
            logger.info("Posts are DIFFERENT")
            return {
                "is_same": False,
                "new_details": result_clean
            }
    
    except Exception as e:
        logger.error(f"Error in comparison: {e}", exc_info=True)
        return {"is_same": False, "new_details": new_content}